/* eslint-disable curly */
/* eslint-disable header/header */

import {defineNode, defineState, Doc, type DocNode} from 'docnode';
import {
  $getRoot,
  $isElementNode,
  $parseSerializedNode,
  createEditor,
  type CreateEditorArgs,
  type ElementNode,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
} from 'lexical';

export function docToLexical(
  config: CreateEditorArgs,
  // If no doc is provided, it will create a new one.
  doc = new Doc({extensions: [{nodes: [LexicalDocNode]}]}),
): {editor: LexicalEditor; doc: Doc} {
  const lexicalKeyToDocNodeId = new Map<string, string>();
  const docNodeIdToLexicalKey = new Map<string, string>();

  const editor = createEditor(config);
  editor.update(
    () => {
      const root = $getRoot();
      root.clear();

      const processChildren = (
        parentDocNode: DocNode,
        parentLexicalNode: LexicalNode,
      ) => {
        parentDocNode.children().forEach((child: DocNode) => {
          if (!child.is(LexicalDocNode)) {
            throw new Error('Expected child to be a LexicalDocNode');
          }
          const serializedLexicalNode = child.state.j.get();

          const lexicalNode = $parseSerializedNode(serializedLexicalNode);
          lexicalKeyToDocNodeId.set(lexicalNode.getKey(), child.id);
          docNodeIdToLexicalKey.set(child.id, lexicalNode.getKey());

          if ($isElementNode(parentLexicalNode)) {
            parentLexicalNode.append(lexicalNode);
          }

          // Recursively process children
          if ($isElementNode(lexicalNode)) {
            processChildren(child, lexicalNode);
          }
        });
      };

      processChildren(doc.root, root);
    },
    {discrete: true},
  );

  // Sync Lexical → DocNode
  editor.registerUpdateListener(
    ({editorState, dirtyElements, dirtyLeaves, tags}) => {
      // Skip if update came from DocNode to avoid infinite loop
      if (tags.has('docnode')) {
        return;
      }

      // Only sync if root has changes
      if (!dirtyElements.has('root')) {
        return;
      }

      // Read Lexical state and sync to DocNode
      editorState.read(() => {
        const lexicalRoot = $getRoot();
        $syncLexicalToDocNode(
          doc,
          doc.root,
          lexicalRoot,
          dirtyElements,
          dirtyLeaves,
          lexicalKeyToDocNodeId,
          docNodeIdToLexicalKey,
        );
      });
    },
  );

  return {doc, editor};
}

export const LexicalDocNode = defineNode({
  state: {
    j: defineState({
      fromJSON: (json: unknown) =>
        (json ?? {}) as SerializedLexicalNode & {[key: string]: unknown},
    }),
  },
  type: 'l',
});

/**
 * Sync Lexical node tree to DocNode using simple DFS with dirty checking
 */
function $syncLexicalToDocNode(
  doc: Doc,
  docParentNode: DocNode,
  lexicalNode: ElementNode,
  dirtyElements: Map<NodeKey, boolean>,
  dirtyLeaves: Set<NodeKey>,
  lexicalKeyToDocNodeId: Map<string, string>,
  docNodeIdToLexicalKey: Map<string, string>,
): void {
  const lexicalChildren = lexicalNode.getChildren();

  // Build map of existing DocNode children for O(1) lookup
  const docChildrenMap = new Map<string, DocNode>();
  let docChild = docParentNode.first;
  while (docChild) {
    docChildrenMap.set(docChild.id, docChild);
    docChild = docChild.next;
  }

  // Track which DocNodes we've processed (to delete unused ones later)
  const seenDocNodeIds = new Set<string>();

  // Process each Lexical child in order
  let prevDocChild: DocNode | undefined;
  for (const lexicalChild of lexicalChildren) {
    const lexicalKey = lexicalChild.getKey();
    const mappedDocNodeId = lexicalKeyToDocNodeId.get(lexicalKey);

    if (mappedDocNodeId && docChildrenMap.has(mappedDocNodeId)) {
      // Node exists - update content and position
      const existingDocNode = docChildrenMap.get(mappedDocNodeId)!;
      seenDocNodeIds.add(mappedDocNodeId);

      // Update content if dirty
      $syncNodeContent(
        doc,
        existingDocNode,
        lexicalChild,
        dirtyElements,
        dirtyLeaves,
        lexicalKeyToDocNodeId,
        docNodeIdToLexicalKey,
      );

      // Ensure correct position (handle moves)
      if (prevDocChild) {
        // Should be right after prevDocChild
        if (existingDocNode.prev !== prevDocChild) {
          existingDocNode.move(prevDocChild, 'after');
        }
      } else {
        // Should be first child
        if (docParentNode.first !== existingDocNode) {
          // Move to first by moving before current first child
          const currentFirst = docParentNode.first;
          if (currentFirst && currentFirst !== existingDocNode) {
            existingDocNode.move(currentFirst, 'before');
          }
        }
      }

      prevDocChild = existingDocNode;
    } else {
      // Node doesn't exist - create it
      const newDocNode = createDocNodeFromLexical(
        doc,
        lexicalChild,
        dirtyElements,
        dirtyLeaves,
        lexicalKeyToDocNodeId,
        docNodeIdToLexicalKey,
      );

      // Insert at correct position
      if (prevDocChild) {
        prevDocChild.insertAfter(newDocNode);
      } else {
        docParentNode.prepend(newDocNode);
      }

      seenDocNodeIds.add(newDocNode.id);
      prevDocChild = newDocNode;
    }
  }

  // Delete DocNodes that no longer exist in Lexical
  for (const [docNodeId, docNode] of docChildrenMap) {
    if (!seenDocNodeIds.has(docNodeId)) {
      // Clean up mappings
      const mappedKey = docNodeIdToLexicalKey.get(docNodeId);
      if (mappedKey) {
        lexicalKeyToDocNodeId.delete(mappedKey);
        docNodeIdToLexicalKey.delete(docNodeId);
      }
      docNode.delete();
    }
  }
}

/**
 * Update an existing DocNode's content from LexicalNode
 * Only processes dirty nodes to avoid unnecessary work
 */
function $syncNodeContent(
  doc: Doc,
  docNode: DocNode<typeof LexicalDocNode>,
  lexicalNode: LexicalNode,
  dirtyElements: Map<NodeKey, boolean>,
  dirtyLeaves: Set<NodeKey>,
  lexicalKeyToDocNodeId: Map<string, string>,
  docNodeIdToLexicalKey: Map<string, string>,
): void {
  const lexicalKey = lexicalNode.getKey();
  const isDirty = dirtyElements.has(lexicalKey) ?? dirtyLeaves.has(lexicalKey);

  if (!isDirty) return;

  const serialized = lexicalNode.exportJSON();
  // const currentJSON = docNode.state.j.get();

  // I think this is unnecessary because docnode already does a deep comparison when setting the state.
  // Deep comparison only when dirty (like Yjs V1 does with prevValue !== nextValue)
  // if (JSON.stringify(currentJSON) !== JSON.stringify(serialized)) {
  docNode.state.j.set(serialized);
  // }

  // Recurse into children if element
  if ($isElementNode(lexicalNode)) {
    $syncLexicalToDocNode(
      doc,
      docNode,
      lexicalNode,
      dirtyElements,
      dirtyLeaves,
      lexicalKeyToDocNodeId,
      docNodeIdToLexicalKey,
    );
  }
}

/**
 * Create a new DocNode from a LexicalNode
 */
function createDocNodeFromLexical(
  doc: Doc,
  lexicalNode: LexicalNode,
  dirtyElements: Map<NodeKey, boolean>,
  dirtyLeaves: Set<NodeKey>,
  lexicalKeyToDocNodeId: Map<string, string>,
  docNodeIdToLexicalKey: Map<string, string>,
): DocNode<typeof LexicalDocNode> {
  const newDocNode = doc.createNode(LexicalDocNode);

  const serialized = lexicalNode.exportJSON();
  newDocNode.state.j.set(serialized);

  // Store mapping
  lexicalKeyToDocNodeId.set(lexicalNode.getKey(), newDocNode.id);
  docNodeIdToLexicalKey.set(newDocNode.id, lexicalNode.getKey());

  // Recursively create children if element
  if ($isElementNode(lexicalNode)) {
    lexicalNode.getChildren().forEach((child) => {
      const childDocNode = createDocNodeFromLexical(
        doc,
        child,
        dirtyElements,
        dirtyLeaves,
        lexicalKeyToDocNodeId,
        docNodeIdToLexicalKey,
      );
      newDocNode.append(childDocNode);
    });
  }

  return newDocNode;
}
