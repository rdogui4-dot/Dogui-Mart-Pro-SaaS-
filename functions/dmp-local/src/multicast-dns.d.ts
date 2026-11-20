declare module "multicast-dns" {
  type Mdns = { on(event: string, cb: (...a: any[]) => void): void; respond(r: { answers: unknown[] }): void; destroy(): void };
  export default function mdns(opts?: Record<string, unknown>): Mdns;
}
