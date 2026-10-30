"""Plot a completed soak report. Uses matplotlib; never changes acceptance data."""
import argparse
import csv
import json
from pathlib import Path

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

parser = argparse.ArgumentParser()
parser.add_argument('report', type=Path)
parser.add_argument('--out', type=Path, required=True)
args = parser.parse_args()
report = json.loads(args.report.read_text(encoding='utf-8'))
if not report.get('finished') or report.get('mode') != 'soak':
    raise SystemExit('A completed soak report is required')
samples = report['samples']
if not samples:
    raise SystemExit('Missing memory samples')
args.out.mkdir(parents=True, exist_ok=True)
minutes = [s['elapsedMs'] / 60000 for s in samples]
mib = 1024 ** 2
fig, axes = plt.subplots(2, 2, figsize=(12, 7), sharex=True, constrained_layout=True)
series = [
    ('V8 used heap (main + renderers)', 'MiB', [s['heapBytes'] / mib for s in samples]),
    ('Process private memory (all app processes)', 'MiB', [s['privateBytes'] / mib for s in samples]),
    ('Pending preview work', 'Jobs', [s['preview']['pending'] for s in samples]),
    ('Preview cache (UTF-16 estimate)', 'MiB', [s['preview']['cacheBytes'] / mib for s in samples]),
]
for axis, (title, unit, values) in zip(axes.flat, series):
    axis.plot(minutes, values, linewidth=0.8, color='#2563eb')
    recovery = [(x, y) for x, y, s in zip(minutes, values, samples) if s['phase'] == 'recovery']
    if recovery:
        axis.scatter(*zip(*recovery), s=3, color='#16a34a', label='Recovery')
    axis.axvspan(0, 15, color='#94a3b8', alpha=0.15, label='Warmup')
    axis.set(title=title, ylabel=unit, xlabel='Elapsed minutes')
    axis.grid(alpha=0.2)
    axis.legend(fontsize=8, loc='best')
fig.suptitle(f"Reliability soak — {report['previewOptimization']} — {report['memory']['decision']}")
fig.savefig(args.out / 'soak-memory.png', dpi=160)
fig.savefig(args.out / 'soak-memory.svg')
plt.close(fig)
with (args.out / 'soak-memory.csv').open('w', newline='', encoding='utf-8') as output:
    writer = csv.writer(output)
    writer.writerow(['elapsed_ms', 'cycle', 'phase', 'heap_bytes', 'private_bytes', 'pending', 'active', 'active_generations', 'queued_generations', 'cache_entries', 'cache_bytes', 'retry_entries', 'main_ipc_listeners', 'renderer_ipc_listeners', 'heavy_workers'])
    for s in samples:
        writer.writerow([s['elapsedMs'], s['cycle'], s['phase'], s['heapBytes'], s['privateBytes'], s['preview']['pending'], s['preview']['active'], s['preview']['activeGenerations'], s['preview']['queuedGenerations'], s['preview']['cacheEntries'], s['preview']['cacheBytes'], s['preview']['retryEntries'], s['mainIpcListeners']['total'], s['rendererIpcListeners']['total'], s['heavyWorkerProcesses']])
print(args.out / 'soak-memory.png')
