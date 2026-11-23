export class RaceError extends Error {
  constructor(code, status, message) {
    super(message);
    this.name = "RaceError";
    this.code = code;
    this.status = status;
  }
}
