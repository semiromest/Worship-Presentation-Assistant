const fs = require('node:fs');
const path = require('node:path');
const reports = [];
for (const file of process.argv.slice(2)) {
  const h = JSON.parse(fs.readFileSync(file, 'utf8'));
  const fields = h.snapshot.meta.node_fields, width = fields.length;
  const index = Object.fromEntries(fields.map((name, i) => [name, i]));
  const types = h.snapshot.meta.node_types[index.type];
  const counts = {}, objects = {}, detached = {};
  let selfBytes = 0, previewStrings = 0, previewCharacters = 0, externalArrayBufferBytes = 0;
  for (let offset = 0; offset < h.nodes.length; offset += width) {
    const type = types[h.nodes[offset + index.type]], name = h.strings[h.nodes[offset + index.name]], size = h.nodes[offset + index.self_size];
    counts[type] = (counts[type] || 0) + 1; selfBytes += size;
    if ((type === 'object' || type === 'native') && /Canvas|FileReader|Blob|WebSocket|HTMLImageElement|NativeImage|ArrayBuffer|^Buffer$|^Promise$/.test(name)) {
      const entry = objects[name] ||= { count: 0, selfBytes: 0 }; entry.count++; entry.selfBytes += size;
    }
    if (type === 'native' && /JSArrayBufferData/.test(name)) externalArrayBufferBytes += size;
    if (type === 'native' && (index.detachedness !== undefined && h.nodes[offset + index.detachedness] === 2 || /^Detached /.test(name))) detached[name] = (detached[name] || 0) + 1;
    if (type === 'string' && name.startsWith('data:image/')) { previewStrings++; previewCharacters += name.length; }
  }
  reports.push({ file: path.basename(file), nodeCount: h.nodes.length / width, selfBytes, counts, detachednessAvailable: index.detachedness !== undefined, detachedNativeNodes: detached, selectedObjects: objects, flatImageDataStrings: { count: previewStrings, characters: previewCharacters }, externalArrayBufferBytes });
}
process.stdout.write(JSON.stringify(reports, null, 2) + '\n');
