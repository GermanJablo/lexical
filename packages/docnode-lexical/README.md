# `@lexical/docnode`

This package provides integration between Lexical and DocNode, allowing you to synchronize a Lexical editor with a DocNode document structure.

## Installation

```bash
npm install @lexical/docnode docnode
```

## Usage

```typescript
import {docToLexical, LexicalDocNode} from '@lexical/docnode';
import {Doc} from 'docnode';

// Create a Lexical editor connected to a DocNode document
const {editor, doc} = docToLexical({
  namespace: 'MyEditor',
  onError: (error) => {
    console.error(error);
  },
});
```

## API

### `docToLexical(config, doc?)`

Creates a Lexical editor instance synchronized with a DocNode document.

**Parameters:**
- `config`: Lexical editor configuration
- `doc`: Optional existing DocNode document (creates a new one if not provided)

**Returns:**
- `{editor, doc}`: The Lexical editor and DocNode document instances

### `LexicalDocNode`

A DocNode node definition for storing Lexical serialized nodes.
