import { join } from 'path'
console.log('import.meta.dir:', import.meta.dir)
console.log('import.meta.url:', import.meta.url)
console.log('path with ../..:', join(import.meta.dir, '..', '..', 'dev.db'))
console.log('path with ../../..:', join(import.meta.dir, '..', '..', '..', 'dev.db'))
