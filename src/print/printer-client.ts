import TcpSocket from 'react-native-tcp-socket';

const DEFAULT_PORT = 9100; // standard raw ESC/POS port on network thermal printers
const CONNECT_TIMEOUT_MS = 4000;
const TOTAL_TIMEOUT_MS = 8000;

export class PrinterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PrinterError';
  }
}

/** Accepts "192.168.0.223" or "192.168.0.223:9100". */
export function parsePrinterAddress(address: string): { host: string; port: number } {
  const trimmed = address.trim().replace(/^[a-z]+:\/\//i, '');
  const [host, portStr] = trimmed.split(':');
  const port = portStr ? Number(portStr) : DEFAULT_PORT;
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new PrinterError(`"${address}" is not a valid printer address. Use something like 192.168.0.223:9100.`);
  }
  return { host, port };
}

/** Opens a raw TCP connection straight to the printer, sends the bytes and
 * closes. No bridge device or internet needed — just the restaurant WiFi. */
export function sendToPrinter(address: string, data: Uint8Array): Promise<void> {
  const { host, port } = parsePrinterAddress(address);

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let socket: ReturnType<typeof TcpSocket.createConnection> | null = null;

    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(totalTimer);
      clearTimeout(connectTimer);
      try {
        socket?.destroy();
      } catch {
        // already closed
      }
      if (err) reject(err);
      else resolve();
    };

    const totalTimer = setTimeout(() => finish(new PrinterError(`The printer at ${host}:${port} did not respond.`)), TOTAL_TIMEOUT_MS);
    const connectTimer = setTimeout(
      () => finish(new PrinterError(`Could not reach the printer at ${host}:${port}. Check it is on and on the same WiFi.`)),
      CONNECT_TIMEOUT_MS
    );

    try {
      socket = TcpSocket.createConnection({ host, port }, () => {
        clearTimeout(connectTimer);
        socket?.write(data, undefined, (err) => {
          if (err) finish(new PrinterError(`Sending to the printer failed: ${err.message}`));
          // Give the printer a moment to take the bytes before closing.
          else setTimeout(() => finish(), 300);
        });
      });
      socket.on('error', (e: Error) => finish(new PrinterError(`Printer connection failed: ${e.message}`)));
    } catch (e) {
      finish(new PrinterError(e instanceof Error ? e.message : 'Could not open a connection to the printer.'));
    }
  });
}
