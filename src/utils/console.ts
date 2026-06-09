const COLOR = process.stdout.isTTY ?? false;
const paint = (code: number) => (s: string) =>
  COLOR ? `\x1b[${code}m${s}\x1b[0m` : s;

export const bold = paint(1);
export const dim = paint(2);
export const green = paint(32);
export const cyan = paint(36);
export const yellow = paint(33);
export const magenta = paint(35);

export function link(url: string, color: (s: string) => string = cyan): string {
  if (!COLOR) return url;
  return `\x1b]8;;${url}\x1b\\${color(url)}\x1b]8;;\x1b\\`;
}
