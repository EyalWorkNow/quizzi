import re

def main():
    with open('src/server/routes/api.ts', 'r') as f:
        content = f.read()

    # Find and make express route handlers async
    # Pattern: router.get('/path', (req, res) => {
    # Replace: router.get('/path', async (req, res) => {
    content = re.sub(r'(router\.(?:get|post|put|delete)\([^,]+(?:,\s*[a-zA-Z0-9_]+)?,\s*)\((req,\s*res(?:,\s*next)?)\)\s*=>\s*\{', r'\1async (\2) => {', content)

    # Make inner functions that use db async
    # We will do a generic replacement for db.prepare
    
    # 1. db.prepare('...').get(...) -> await db.prepare('...').get(...)
    content = re.sub(r'(?<!await\s)db\.prepare\((.*?)\)\.(get|all|run)\((.*?)\)', r'await db.prepare(\1).\2(\3)', content)
    
    # 2. handle transaction definitions: const xyz = db.transaction((args) => { ... })
    # We will make the inner function async: const xyz = db.transaction(async (args) => { ... })
    content = re.sub(r'db\.transaction\(\((.*?)\)\s*=>\s*\{', r'db.transaction(async (\1) => {', content)

    # 3. Handle chained maps on db operations (e.g. await db.prepare(...).all().map)
    # The regex above will produce: (await db.prepare(...).all(...)).map 
    # Actually it just produced await db.prepare(...).all().map which is invalid because all() returns a promise now.
    # We need to wrap it: (await db.prepare(...).all(...)).map
    # Let's write a smarter regex for map or just run it and see.
    # Let's fix map calls: await (db.prepare(x).all(y)).map -> (await db.prepare(x).all(y)).map
    content = re.sub(r'await\s(db\.prepare\(.*?\)\.all\(.*?\))\.map\(', r'(await \1).map(', content)
    
    # Add RETURNING id to insert statements that expect an id
    # This is trickier, better to handle in our DB proxy.
    
    with open('src/server/routes/api.ts.new', 'w') as f:
        f.write(content)

if __name__ == '__main__':
    main()
