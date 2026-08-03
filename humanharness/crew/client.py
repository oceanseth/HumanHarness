"""Guild routing boundary with local and JSON-RPC implementations."""

from __future__ import annotations

import json
from collections.abc import Callable, Mapping
from typing import Any, Literal
from urllib.request import Request, urlopen

from pydantic import ValidationError

from ..contracts import CommentaryDecision, Moment, PersonaProposal
from .schemas import GuildTurnRequest, GuildTurnResponse, SchemaValidationError

JsonRpcTransport = Callable[[dict[str, Any]], Mapping[str, Any]]
BridgeTransport = Callable[[str, dict[str, str], bytes], tuple[int, bytes]]


class GuildClientError(RuntimeError):
    """A Guild policy could not produce a valid commentary decision."""


class GuildClient:
    """Select commentary using the local policy or a Guild JSON-RPC endpoint."""

    def __init__(
        self,
        mode: Literal["mock", "json-rpc"] | str = "mock",
        *,
        endpoint: str | None = None,
        api_key: str | None = None,
        transport: JsonRpcTransport | BridgeTransport | None = None,
    ) -> None:
        # Preserve the pre-existing Python-to-TypeScript bridge constructor:
        # GuildClient("https://guild.example", transport=...).
        if mode not in {"mock", "json-rpc"}:
            self.mode: Literal["mock", "json-rpc", "bridge"] = "bridge"
            self.endpoint = mode
            self.api_key = api_key
            self.transport = transport
            return
        if mode == "json-rpc" and endpoint is None and transport is None:
            raise ValueError("A JSON-RPC endpoint or transport is required in json-rpc mode.")
        self.mode = mode
        self.endpoint = endpoint
        self.api_key = api_key
        self.transport = transport

    def send_turn(self, turn: GuildTurnRequest) -> GuildTurnResponse:
        """Send a legacy Guild bridge turn while preserving its causal parent."""

        if self.mode != "bridge":
            raise GuildClientError("send_turn is available only for a Guild bridge endpoint.")
        url = f"{self.endpoint.rstrip('/')}/guild/turns"
        headers = {
            "Content-Type": "application/json",
            "X-HumanHarness-Provenance-Id": turn.provenance.provenance_id,
            "X-HumanHarness-Context-Hashes": json.dumps(turn.provenance.context_hashes, sort_keys=True),
            "X-HumanHarness-Schema-Version": turn.provenance.schema_version,
        }
        body = json.dumps(turn.to_wire()).encode("utf-8")
        try:
            if self.transport:
                status, response_body = self.transport(url, headers, body)  # type: ignore[call-arg]
            else:
                request = Request(url, data=body, headers=headers, method="POST")
                with urlopen(request, timeout=10) as response:  # noqa: S310 - endpoint is caller-configured
                    status, response_body = response.status, response.read()
            if not 200 <= status < 300:
                raise GuildClientError(f"Guild bridge returned HTTP {status}.")
            response = GuildTurnResponse.from_wire(json.loads(response_body))
        except (OSError, ValueError, json.JSONDecodeError, SchemaValidationError) as error:
            raise GuildClientError(f"Guild bridge request failed: {error}") from error
        if response.provenance.parent_provenance_id != turn.provenance.provenance_id:
            raise GuildClientError("Guild bridge response provenance must name the request as its parent.")
        return response

    def decide_commentary(self, moment: Moment) -> CommentaryDecision | None:
        """Return a decision for ``moment``, or ``None`` when no proposal exists."""

        if self.mode == "mock":
            return self._mock_decision(moment)
        return self._json_rpc_decision(moment)

    @staticmethod
    def _mock_decision(moment: Moment) -> CommentaryDecision | None:
        if not moment.persona_proposals:
            return None
        proposal: PersonaProposal = max(moment.persona_proposals, key=lambda item: item.priority)
        return CommentaryDecision(
            provenance_id=f"{proposal.provenance_id}:commentary-decision",
            parent_provenance_id=proposal.provenance_id,
            root_event_id=moment.root_event_id,
            context_hashes=[*moment.context_hashes, *proposal.context_hashes],
            moment_id=moment.moment_id,
            persona_id=proposal.persona_id,
            commentary=proposal.commentary,
            reason="mock Guild policy selected the highest-priority proposal",
        )

    def _json_rpc_decision(self, moment: Moment) -> CommentaryDecision:
        request = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "guild.commentary.decide",
            "params": {
                "moment": moment.model_dump(mode="json"),
                "provenance": self._provenance_headers(moment),
            },
        }
        response = self.transport(request) if self.transport else self._post(request)  # type: ignore[call-arg]
        if error := response.get("error"):
            raise GuildClientError(f"Guild JSON-RPC error: {error}")
        result = response.get("result")
        if not isinstance(result, Mapping):
            raise GuildClientError("Guild JSON-RPC response is missing an object result.")
        try:
            return CommentaryDecision.model_validate(result)
        except ValidationError as error:
            raise GuildClientError(f"Guild JSON-RPC returned an invalid decision: {error}") from error

    @staticmethod
    def _provenance_headers(moment: Moment) -> dict[str, Any]:
        """Build the provenance envelope shared verbatim with TypeScript.

        A Guild decision is only meaningful when the receiving runtime can
        trace it to the original event and the exact context it used.
        """

        return {
            "provenance_id": moment.provenance_id,
            "parent_provenance_id": moment.parent_provenance_id,
            "root_event_id": moment.root_event_id,
            "source_actor": moment.source_actor,
            "context_hashes": moment.context_hashes,
        }

    def _post(self, payload: dict[str, Any]) -> Mapping[str, Any]:
        assert self.endpoint is not None
        headers = {"Content-Type": "application/json"}
        provenance = payload["params"]["provenance"]
        assert isinstance(provenance, Mapping)
        headers.update(
            {
                "X-HumanHarness-Provenance-Id": str(provenance["provenance_id"]),
                "X-HumanHarness-Parent-Provenance-Id": str(provenance["parent_provenance_id"] or ""),
                "X-HumanHarness-Root-Event-Id": str(provenance["root_event_id"]),
                "X-HumanHarness-Source-Actor": str(provenance["source_actor"]),
                "X-HumanHarness-Context-Hashes": json.dumps(provenance["context_hashes"]),
            }
        )
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        request = Request(self.endpoint, data=json.dumps(payload).encode("utf-8"), headers=headers, method="POST")
        try:
            with urlopen(request, timeout=10) as response:  # noqa: S310 - endpoint is caller-configured
                decoded = json.load(response)
        except (OSError, ValueError, json.JSONDecodeError) as error:
            raise GuildClientError(f"Guild JSON-RPC request failed: {error}") from error
        if not isinstance(decoded, Mapping):
            raise GuildClientError("Guild JSON-RPC response must be an object.")
        return decoded
