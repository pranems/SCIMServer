const { once } = require('node:events');
const frame = value => `2026-10-23T00:00:00.000000000Z ${value}\n`;
async function write(stream, value) {
  if (!stream.write(value)) await once(stream, 'drain');
}
async function run() {
  const mode = process.argv[2];
  if (mode === 'bulk' || mode === 'total') {
    const record = frame('x'.repeat(4096));
    const count = Math.ceil((mode === 'bulk' ? 9 : 65) * 1024 * 1024 / record.length);
    for (const stream of mode === 'bulk' ? [process.stdout, process.stderr] : [process.stdout])
      for (let i = 0; i < count; i++) await write(stream, record);
  } else if (mode === 'long') await write(process.stdout, frame('x'.repeat(65537)).slice(0, -1));
  else if (mode === 'split') {
    const value = process.argv[3];
    for (const char of frame(value)) {
      await write(process.stderr, char);
      if (process.connected) await once(process, 'message');
    }
  } else if (mode === 'cross-frame') {
    const value = process.argv[3];
    await write(process.stdout, frame(value.slice(0, 9)));
    await write(process.stdout, frame(value.slice(9)));
  } else if (mode === 'cross-channel' || mode === 'cross-channel-reverse') {
    const streams = mode === 'cross-channel' ? [process.stdout, process.stderr] : [process.stderr, process.stdout];
    await write(streams[0], frame(process.argv[3].slice(0, 9)));
    await write(streams[1], frame(process.argv[3].slice(9)));
  } else if (mode === 'correlation') {
    await write(process.stdout, frame(JSON.stringify({ timestamp: 'fixed', category: 'scim.patch',
      requestId: process.argv[3] })));
  } else if (mode === 'ambiguous' || mode === 'exit-private')
    await write(process.stderr, `${process.argv[3]}\n`);
  else if (mode === 'partial') await write(process.stdout, frame('not complete').slice(0, -1));
  else if (mode !== 'empty') await write(process.stdout, frame('nonsecret fixture ready'));
  if (mode === 'hang') return setInterval(() => {}, 1000);
  if (process.connected) process.disconnect();
  if (mode === 'exit' || mode === 'exit-private') process.exitCode = 7;
}
if (process.send) {
  process.send({ fixture: 'ready' });
  process.once('message', message => {
    if (message?.fixture === 'go') run().catch(() => { process.exitCode = 9; process.disconnect(); });
  });
} else run().catch(() => { process.exitCode = 9; });
