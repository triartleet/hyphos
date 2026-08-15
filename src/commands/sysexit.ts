/**
 * A tiny error type that mirrors Python's `sys.exit("message")`.
 *
 * In the reference CLI several helpers call `sys.exit(msg)` deep in the call
 * stack. That raises `SystemExit`, which the local web server catches and turns
 * into an HTTP 502, while the command-line path lets it print the message to
 * stderr and exit with status 1. `SysExit` carries the same string so both
 * surfaces can reproduce that behaviour exactly.
 */
export class SysExit extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SysExit";
  }
}
