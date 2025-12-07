# DocNode-Lexical Integration Design Document

## TL;DR - How It Works

**The Problem:** Keep Lexical editor and DocNode document in sync as user types.

**The Solution:** Simple DFS with dirty tracking (similar to Lexical's Reconciler):

```typescript
When user types:
  1. Check what changed (dirtyElements + dirtyLeaves)
  2. Iterate through children in order
  3. Skip clean nodes (O(1) dirty check)
  4. For dirty nodes: Update/Create/Delete/Move as needed
```

**Key Insight:** Lexical already tells us what's dirty via `dirtyElements` and `dirtyLeaves`. No need for complex bidirectional scanning - just check if each node is dirty before processing.

**Status:** ✅ Lexical → DocNode sync complete (10/10 tests passing)

---

## Overview

This document outlines the design and implementation strategies for `docnode-lexical`, a binding between [Lexical](https://lexical.dev) editor and [DocNode](https://docnode.dev), a modern alternative to Yjs for collaborative editing.

DocNode differs from Yjs in its approach:
- **Automatic transaction batching** (no need for explicit `doc.transact()`)
- **Compact inverse operations** for undo/redo instead of full state snapshots
- **Built-in normalization phase** for enforcing document structure
- **Clear lifecycle stages**: idle → update → normalize → change

## Background: How Lexical-Yjs Works

### Two-Way Synchronization

The existing Lexical-Yjs integration uses two parallel sync mechanisms:

#### 1. **Yjs → Lexical** (Remote changes)
```typescript
root.getSharedType().observeDeep(onYjsTreeChanges);

const onYjsTreeChanges = (events, transaction) => {
  if (origin !== binding) {
    syncYjsChangesToLexical(binding, provider, events, isFromUndoManager);
  }
};
```

#### 2. **Lexical → Yjs** (Local changes)
```typescript
editor.registerUpdateListener(({
  prevEditorState,
  editorState,
  dirtyElements,
  dirtyLeaves,
  normalizedNodes,
  tags,
}) => {
  syncLexicalUpdateToYjs(binding, provider, prevEditorState, editorState, 
                         dirtyElements, dirtyLeaves, normalizedNodes, tags);
});
```

**Key Insight:** Yjs uses `.observeDeep()` (not `.addEventListener()`), while Lexical uses `.registerUpdateListener()` for the binding.

## Core Concepts

### 1. Dirty Nodes vs Mutated Nodes

Understanding the difference is crucial:

| Aspect           | Dirty Nodes                                      | Mutated Nodes                                   |
| ---------------- | ------------------------------------------------ | ----------------------------------------------- |
| **When set**     | During update (when `node.getWritable()` called) | After reconciliation (DOM diffing)              |
| **Purpose**      | Track which nodes changed in EditorState         | Track DOM mutations (created/updated/destroyed) |
| **Availability** | Always available in UpdateListener               | Only if `MutationListener` registered           |
| **Contains**     | `dirtyElements` (Map) + `dirtyLeaves` (Set)      | Map of `NodeKey → NodeMutation`                 |
| **Used for**     | Determining what to sync                         | Observing final DOM changes                     |

### 2. Node Mutation Lifecycle

Node mutations follow strict rules:

```typescript
export type NodeMutation = 'created' | 'updated' | 'destroyed';
```

**Key Rule:** First mutation wins (with one exception)

```typescript
const prevMutation = mutatedNodesByType.get(nodeKey);
const isMove = prevMutation === 'destroyed' && mutation === 'created';
if (prevMutation === undefined || isMove) {
  mutatedNodesByType.set(nodeKey, isMove ? 'updated' : mutation);
}
```

**Special Cases:**
- `destroyed` + `created` → `updated` (move detection)
- `updated` + `created` → `updated` (first wins)
- `updated` + `destroyed` → `updated` (happens when `updateDOM()` returns true)

### 3. The Reconciliation Algorithm

All three systems (Lexical Reconciler, Yjs V1, Yjs V2) use similar **two-pointer diff algorithms**:

```typescript
// Common pattern across all implementations
while (prevIndex <= prevEndIndex && nextIndex <= nextEndIndex) {
  const prevKey = prevChildren[prevIndex];
  const nextKey = nextChildren[nextIndex];
  
  if (prevKey === nextKey) {
    // Update existing node
    reconcile(nextKey);
    prevIndex++; nextIndex++;
  } else {
    // Lazy create Sets for O(1) lookup
    if (!prevChildrenSet) prevChildrenSet = new Set(prevChildren);
    if (!nextChildrenSet) nextChildrenSet = new Set(nextChildren);
    
    const nextHasPrevKey = nextChildrenSet.has(prevKey);
    const prevHasNextKey = prevChildrenSet.has(nextKey);
    
    if (!nextHasPrevKey) {
      // Remove
    } else if (!prevHasNextKey) {
      // Create
    } else {
      // Move
    }
  }
}
```

#### Comparative Analysis

| Aspect                | Reconciler (DOM)                          | Yjs V1                              | Yjs V2                               |
| --------------------- | ----------------------------------------- | ----------------------------------- | ------------------------------------ |
| **Objective**         | Update DOM                                | Update Yjs                          | Update Yjs                           |
| **Base structure**    | Two-pointer                               | Two-pointer                         | Two-pointer bidirectional            |
| **Compares**          | `prevNodeMap ↔ nextNodeMap`               | `prevNodeMap ↔ nextNodeMap`         | `yChildren ↔ lChildren`              |
| **When keys match**   | `$reconcileNode()` + update DOM           | `_syncChildFromLexical()` recursive | **Optimizes:** only if dirty         |
| **Detects moves**     | ✅ Yes                                     | ✅ Yes                               | ✅ Yes                                |
| **Lazy Sets**         | ✅ Only creates if diff                    | ✅ Only creates if diff              | ❌ Doesn't use sets                   |
| **Creates mutations** | ✅ `setMutatedNode()`                      | ❌ No                                | ❌ No                                 |
| **Uses dirty check**  | ✅ To skip updates                         | ✅ Passes `dirtyElements`            | ✅ **Uses to skip recursion**         |
| **Tail handling**     | `$createChildren()` / `destroyChildren()` | Manual loop                         | `yDomFragment.delete()` / `insert()` |


## Implementation Approach: Simple DFS with Dirty Tracking

### Core Algorithm

```typescript
function $syncLexicalToDocNode(doc, docParent, lexicalNode, dirtyElements, dirtyLeaves, ...) {
  // 1. Build map of existing DocNode children (O(1) lookup)
  const docChildrenMap = new Map();
  let docChild = docParent.first;
  while (docChild) {
    docChildrenMap.set(docChild.id, docChild);
    docChild = docChild.next;
  }
  
  // 2. Process each Lexical child in order
  let prevDocChild;
  for (const lexicalChild of lexicalNode.getChildren()) {
    const mappedDocNodeId = map.get(lexicalChild.key);
    
    if (mappedDocNodeId && docChildrenMap.has(mappedDocNodeId)) {
      // EXISTS → Update + maybe move
      const docNode = docChildrenMap.get(mappedDocNodeId);
      $syncNodeContent(docNode, lexicalChild, dirtyElements, dirtyLeaves);
      
      if (needsMove) docNode.move(prevDocChild, 'after');
      prevDocChild = docNode;
    } else {
      // NEW → Create
      const newNode = createDocNodeFromLexical(lexicalChild, ...);
      prevDocChild ? prevDocChild.insertAfter(newNode) : docParent.prepend(newNode);
      prevDocChild = newNode;
    }
  }
  
  // 3. Delete unused DocNodes
  for (const [id, node] of docChildrenMap) {
    if (!seen.has(id)) node.delete();
  }
}

function $syncNodeContent(docNode, lexicalNode, dirtyElements, dirtyLeaves) {
  const isDirty = dirtyElements.has(key) || dirtyLeaves.has(key);
  if (!isDirty) return; // ← Skip clean nodes!
  
  docNode.state.j.set(lexicalNode.exportJSON());
  
  if ($isElementNode(lexicalNode)) {
    $syncLexicalToDocNode(doc, docNode, lexicalNode, ...);
  }
}
```

**Why this works:**
- ✅ **Dirty tracking** - Skip 99% of nodes that didn't change
- ✅ **Single pass** - No complex bidirectional scanning needed
- ✅ **Minimal ops** - Uses `.move()` for repositioning, not delete+create
- ✅ **~60 lines** - Simple and maintainable

### Example: Insert Paragraph in Middle

```
Before: [P1("Hello")] [P2("World")]
After:  [P1("Hello")] [P_NEW("Middle")] [P2("World")]

Sync Process:
  1. P1: exists, not dirty → skip content update
  2. P_NEW: doesn't exist → create + insert
  3. P2: exists, wrong position → move after P_NEW

Operations: 1 create + 1 move
```

### Example: Edit Text

```
Before: [P1(TextNode("Hello"))]
After:  [P1(TextNode("Hello World!"))]

dirtyElements: {'root', 'p1'}
dirtyLeaves: {'text1'}

Sync Process:
  1. P1: dirty (in dirtyElements) → update content
  2. TextNode: dirty (in dirtyLeaves) → update content

Operations: 2 updates
```

## Node Mapping Strategy

**Simple:** One universal `LexicalDocNode` type stores any Lexical node's JSON:

```typescript
export const LexicalDocNode = defineNode({
  state: { j: defineState({ fromJSON: (json) => json ?? {} }) },
  type: 'l',
});
```

Benefits: Works with all node types, forward-compatible, minimal code.

## DocNode-Specific Considerations

### 1. Transaction Handling

DocNode auto-batches mutations in the same microtask:

```typescript
editor.registerUpdateListener(() => {
  // All these mutations auto-batch into one DocNode transaction
  docNode.append(child1);
  docNode.state.j.set(serializedNode);
  child1.state.j.set(serializedChild);
  // DocNode fires onChange once after microtask completes
});
```

### 2. Sync Loop Prevention

Use tags to prevent infinite sync loops:

```typescript
// Lexical → DocNode
editor.registerUpdateListener(({ tags }) => {
  if (tags.has('docnode')) return; // Skip changes from DocNode
  // Sync to DocNode
});

// DocNode → Lexical
doc.onChange(() => {
  editor.update(() => {
    $addUpdateTag('docnode');
    // Apply DocNode changes to Lexical
  }, { tag: 'docnode' });
});
```

### 3. Normalization Phase

DocNode's normalization can enforce Lexical constraints:

```typescript
const LexicalDocNodeExtension: Extension = {
  register(doc) {
    doc.onNormalize(({ diff }) => {
      // Enforce Lexical-specific rules
      // E.g., root must have at least one paragraph
      if (doc.root.children.length === 0) {
        const paragraph = doc.createNode(LexicalDocNode);
        paragraph.state.j.set({ type: 'paragraph', children: [] });
        doc.root.append(paragraph);
      }
    });
  }
};
```

## Implementation Phases

### Phase 1: Core Optimized Sync (MVP)
- [ ] Implement bidirectional diff algorithm (Yjs V2 style)
- [ ] Dirty-checking optimization built-in from start
- [ ] Lexical → DocNode: Serialize and sync with skip logic
- [ ] DocNode → Lexical: Deserialize and apply changes
- [ ] Prevent infinite loops with tags
- [ ] Handle basic node types (paragraph, text, root)

### Phase 2: Complete Node Support
- [ ] Support all element nodes and their children
- [ ] Handle text node formatting and styles
- [ ] Properly sync node properties via `j` state
- [ ] Test with custom Lexical nodes
- [ ] Handle edge cases (moves, normalization)
- [ ] Validate performance: < 16ms for typing operations

### Phase 3: Advanced Features
- [ ] Selection sync with dirty tracking
- [ ] Cursor positions (multi-user awareness)
- [ ] Undo/Redo integration with DocNode's inverse operations
- [ ] Normalization hooks for Lexical constraints
- [ ] Benchmark against Yjs (should be competitive or better)

### Phase 4: Polish & Production Ready
- [ ] Comprehensive test suite
- [ ] Edge case handling (large documents, rapid edits)
- [ ] Memory profiling and optimization
- [ ] Documentation with examples
- [ ] Performance comparison report vs Yjs

## Key Implementation Details

### Bidirectional Diff Algorithm (Yjs V2 Approach)

The core sync function uses bidirectional scanning for optimal performance:

```typescript
function $updateDocNodeFragment(
  doc: DocNodeDoc,
  docNode: DocNode<typeof LexicalDocNode>,
  lexicalNode: ElementNode,
  dirtyElements: Set<NodeKey>
): void {
  // 1. Sync node properties if changed
  const currentJSON = docNode.state.j.get();
  const newJSON = lexicalNode.exportJSON();
  if (!deepEqual(currentJSON, newJSON)) {
    docNode.state.j.set(newJSON);
  }
  
  // 2. Get children
  const docChildren = docNode.children;
  const lexicalChildren = lexicalNode.getChildren();
  const docChildCnt = docChildren.length;
  const lexicalChildCnt = lexicalChildren.length;
  const minCnt = Math.min(docChildCnt, lexicalChildCnt);
  
  let left = 0;
  let right = 0;
  
  // 3. Scan from LEFT - skip matched, unchanged nodes
  for (; left < minCnt; left++) {
    const docChild = docChildren[left];
    const lexicalChild = lexicalChildren[left];
    
    if (isMappedIdentity(docChild, lexicalChild)) {
      // Already synced, only recurse if dirty
      if (lexicalChild instanceof ElementNode && 
          dirtyElements.has(lexicalChild.__key)) {
        $updateDocNodeFragment(doc, docChild, lexicalChild, dirtyElements);
      }
    } else if (sameNodeType(docChild, lexicalChild)) {
      // Update mapping and continue
      updateNodeMapping(docChild, lexicalChild);
    } else {
      break; // Mismatch - handle in main loop
    }
  }
  
  // 4. Scan from RIGHT - skip matched, unchanged nodes
  for (; right + left < minCnt; right++) {
    const docChild = docChildren[docChildCnt - right - 1];
    const lexicalChild = lexicalChildren[lexicalChildCnt - right - 1];
    
    if (isMappedIdentity(docChild, lexicalChild)) {
      if (lexicalChild instanceof ElementNode && 
          dirtyElements.has(lexicalChild.__key)) {
        $updateDocNodeFragment(doc, docChild, lexicalChild, dirtyElements);
      }
    } else if (sameNodeType(docChild, lexicalChild)) {
      updateNodeMapping(docChild, lexicalChild);
    } else {
      break;
    }
  }
  
  // 5. ONLY process middle section if there's a mismatch
  // This is where creates/removes/moves happen
  if (left + right < Math.max(docChildCnt, lexicalChildCnt)) {
    reconcileMiddleSection(
      doc, docNode, docChildren, lexicalChildren,
      left, right, docChildCnt, lexicalChildCnt, dirtyElements
    );
  }
}
```

**Key Optimizations:**
- **Early exit**: If `left + right >= minCnt`, all nodes matched - skip middle processing
- **Dirty gating**: Only recurse into `ElementNode` children if in `dirtyElements`
- **Bidirectional**: Process stable edges first, minimize work on unstable middle
- **Identity checks**: Fast path for nodes that haven't moved or changed

### Serialization Strategy

Since we're using Lexical's serialization:

```typescript
// Lexical → DocNode
const serialized = lexicalNode.exportJSON();
docNode.state.j.set(serialized);

// DocNode → Lexical
const serialized = docNode.state.j.get();
const lexicalNode = $parseSerializedNode(serialized);
```

This leverages Lexical's existing `exportJSON()` and node creation from JSON.

## References

- [Lexical Reconciler](../lexical/src/LexicalReconciler.ts) - Dirty tracking pattern
- [DocNode Docs](https://docnode.dev/llms-full.txt) - Full API reference
- [Implementation](./src/index.ts) - Current code

## Implementation Status

### ✅ Completed (v1.0)

1. **Core Synchronization (Lexical → DocNode)**
   - Simple DFS with dirty tracking (`dirtyElements` + `dirtyLeaves`)
   - Early returns for clean nodes (skip unnecessary work)
   - Proper move detection (uses `.move()` not delete+create)

2. **Node Operations**
   - Create: `createDocNodeFromLexical()` recursively
   - Update: Only when dirty (auto deep-comparison by DocNode)
   - Delete: `.delete()` with mapping cleanup
   - Move: `.move(target, position)` for repositioning

3. **Optimizations**
   - ✅ Dirty gating (skip 99% of unchanged nodes)
   - ✅ O(1) lookup via mapping
   - ✅ No unnecessary stringification
   - ✅ Minimal DocNode operations

4. **Tests: 10/10 passing** ✅

### 🔄 In Progress

- None currently

### 📋 Next Steps

1. **DocNode → Lexical sync** (reverse direction)
2. **Selection/cursor sync**
3. **Normalized nodes handling**
4. **Production hardening** (error handling, edge cases)

---

**Document Version:** 3.0  
**Last Updated:** 2025-12-07  
**Status:** ✅ Lexical → DocNode sync implemented and tested  
**Author:** Based on technical conversation analyzing Lexical-Yjs implementation

