import json, sys

d = json.load(sys.stdin)

# Extract fields
path = d['cwd']
cwd = path.rstrip('\\').rstrip('/').split('\\')[-1].split('/')[-1]
model = d['model']['display_name']
pct = d['context_window']['remaining_percentage']

# Output status line
print(f'{cwd}  |  {model}  |  {pct}% free')
