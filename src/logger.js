export function log(tag, message, extra = {}) {
  const ts = new Date().toISOString();
  const line = `[${ts}] [${tag}] ${message}`;
  try {
    console.log(extra && Object.keys(extra).length ? `${line} ${JSON.stringify(extra)}` : line);
  } catch {
    console.log(line);
  }
}
