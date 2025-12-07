# DocNode-Lexical Integration Design Document

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

**Key Insights:**
- **Reconciler & Yjs V1** are structurally nearly identical (V1 likely copied from Reconciler)
- **Yjs V2** optimizes by scanning from both ends and skipping non-dirty recursions
- All three handle the same edge cases (moves, creates, removes, updates)
- **Our DocNode implementation will follow Yjs V2 from the start** - build optimized, not refactor later

#### Code Similarity Examples

**Pattern 1: Lazy Set Creation** (identical across Reconciler and Yjs V1)

```typescript
// Reconciler
if (prevChildrenSet === undefined) {
  prevChildrenSet = new Set(prevChildren);
}
if (nextChildrenSet === undefined) {
  nextChildrenSet = new Set(nextChildren);
}

// Yjs V1 - LITERALLY THE SAME CODE
if (prevChildrenSet === undefined) {
  prevChildrenSet = new Set(prevChildren);
}
if (nextChildrenSet === undefined) {
  nextChildrenSet = new Set(nextChildren);
}
```

**Pattern 2: Move Detection Logic**

```typescript
// Both use identical logic
const nextHasPrevKey = nextChildrenSet.has(prevKey);
const prevHasNextKey = prevChildrenSet.has(nextKey);

if (!nextHasPrevKey) {
  // Remove prev
} else if (!prevHasNextKey) {
  // Create next
} else {
  // Move next
}
```

**Why this matters:** 
- We'll adapt Yjs V2's optimized algorithm directly
- Bidirectional scanning + dirty-checking from day one
- Built for performance, not retrofitted later
- Handles all edge cases proven by three battle-tested implementations

## Implementation Approach: Tree Diff with `dirtyElements`

**Concept:** Mirror the proven Yjs approach - use `dirtyElements` to identify changed subtrees, then run a two-pointer diff algorithm similar to Lexical's reconciler.

```typescript
editor.registerUpdateListener(({
  prevEditorState,
  editorState,
  dirtyElements,
  dirtyLeaves,
  normalizedNodes,
  tags,
}) => {
  if (tags.has('docnode')) return;
  
  // Only sync if root changed
  if (!dirtyElements.has('root')) return;
  
  editorState.read(() => {
    const lexicalRoot = $getRoot();
    syncLexicalToDocNode(
      doc,
      lexicalRoot,
      prevEditorState._nodeMap,
      dirtyElements,
      dirtyLeaves
    );
  });
});

function syncLexicalToDocNode(
  doc: DocNodeDoc,
  lexicalNode: ElementNode,
  prevNodeMap: NodeMap,
  dirtyElements: Map<NodeKey, boolean>,
  dirtyLeaves: Set<NodeKey>
) {
  // Get prev and next children
  const prevChildren = prevNodeMap.get(lexicalNode.__key)?.__children ?? [];
  const nextChildren = lexicalNode.__children;
  
  // Run two-pointer diff algorithm (similar to reconciler)
  reconcileChildren(doc, prevChildren, nextChildren, dirtyElements);
  
  // Recurse for dirty children
  for (const childKey of nextChildren) {
    if (dirtyElements.has(childKey)) {
      const childNode = lexicalNode.getChildByKey(childKey);
      if ($isElementNode(childNode)) {
        syncLexicalToDocNode(doc, childNode, prevNodeMap, dirtyElements, dirtyLeaves);
      }
    }
  }
}
```

**Why this approach:**
- ✅ **Proven**: Battle-tested in Yjs V1 & V2 implementations
- ✅ **Reliable**: Handles all edge cases (moves, reordering, normalization)
- ✅ **Maintainable**: Clear mental model matching Lexical's reconciler
- ✅ **Complete**: Maintains tree context and structure
- ✅ **Optimizable**: Can skip non-dirty subtrees for better performance

## Node Mapping Strategy

The mapping between Lexical and DocNode is straightforward: **wrap the entire serialized Lexical node in a single DocNode state property**.

```typescript
export const LexicalDocNode = defineNode({
  state: {
    j: defineState({
      fromJSON: (json: unknown) =>
        (json ?? {}) as SerializedLexicalNode & {[key: string]: unknown},
    }),
  },
  type: 'l',
});
```

**Key Points:**
- All Lexical nodes are stored as type `'l'` in DocNode
- The `j` (JSON) property contains the complete `SerializedLexicalNode` including its `type`
- No need for per-node-type mapping - universal approach
- Lexical's serialization/deserialization handles all node types

**Advantages:**
- ✅ Simple: One DocNode type for all Lexical nodes
- ✅ Forward-compatible: Works with custom Lexical nodes automatically
- ✅ Complete: Preserves all Lexical node properties
- ✅ Efficient: Leverages Lexical's existing serialization

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

- [Lexical Reconciler](../lexical/src/LexicalReconciler.ts) - Two-pointer diff algorithm
- [Yjs V1 Sync](../lexical-yjs/src/CollabElementNode.ts) - Tree diff approach
- [Yjs V2 Sync](../lexical-yjs/src/SyncV2.ts) - Optimized bidirectional diff
- [DocNode Documentation](https://docnode.dev/llms-full.txt) - API and lifecycle
- [Current Implementation](./src/index.ts) - Node mapping definition

## Next Steps

1. ✅ ~~Choose implementation approach~~ (Decided: Optimized bidirectional diff, Yjs V2 style)
2. ✅ ~~Define node mapping strategy~~ (Using universal `LexicalDocNode` with `j` property)
3. Implement bidirectional diff with dirty-checking
4. Build Lexical → DocNode sync with skip optimizations
5. Build DocNode → Lexical sync
6. Add tests and benchmark against Yjs
7. Validate performance targets (< 16ms for typing)

---

**Document Version:** 2.0  
**Last Updated:** 2025-01-07  
**Status:** Implementation approach finalized  
**Author:** Based on technical conversation analyzing Lexical-Yjs implementation

