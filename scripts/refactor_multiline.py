import re

FILES = [
    'src/server/routes/api.ts',
    'src/server/db/seeding.ts',
    'src/server/services/materialIntel.ts',
    'src/server/services/teacherUsers.ts'
]

def refactor_file(filepath):
    with open(filepath, 'r') as f:
        content = f.read()

    # 1. db.prepare('...').get(...) -> await db.prepare('...').get(...)
    # Using re.DOTALL so .*? matches newlines
    content = re.sub(r'(?<!await\s)db\.prepare\((.*?)\)\.(get|all|run)\((.*?)\)', r'await db.prepare(\1).\2(\3)', content, flags=re.DOTALL)
    
    # 2. Fix maps and forEach that chain off .all()
    # E.g. (await db.prepare(...).all(...)).map(
    # The previous pass generated `await db.prepare(...).all(...).map` which is invalid.
    # Actually, the first regex generates `await db.prepare(...).all(...).map`? No, the first regex matches `.all(args)`.
    # Wait, `db.prepare(x).all(y).map(z)` => `await db.prepare(x).all(y).map(z)`
    # We want `(await db.prepare(x).all(y)).map(z)`
    content = re.sub(r'await\s+(db\.prepare\(.*?\)\.(?:get|all|run)\([^)]*\))\.([a-zA-Z0-9_]+)\(', r'(await \1).\2(', content, flags=re.DOTALL)

    # 3. Handle transaction definitions: const xyz = db.transaction((args) => { ... })
    content = re.sub(r'db\.transaction\(\((.*?)\)\s*=>\s*\{', r'db.transaction(async (\1) => {', content, flags=re.DOTALL)

    with open(filepath, 'w') as f:
        f.write(content)

for filepath in FILES:
    refactor_file(filepath)
