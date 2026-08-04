class DependencyError extends Error {
  constructor(service, message, options = {}) {
    super(`${service}: ${message}`, options);
    this.name = "DependencyError";
    this.service = service;
  }
}

const asDependencyError = (service, error) => {
  if (error instanceof DependencyError) return error;
  const message = error instanceof Error ? error.message : String(error || "unknown failure");
  return new DependencyError(service, message, { cause: error });
};

module.exports = { DependencyError, asDependencyError };
