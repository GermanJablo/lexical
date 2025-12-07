import {Doc, type DocNode} from 'docnode';
import {
  $getRoot,
  $isElementNode,
  $parseSerializedNode,
  LexicalEditor,
  LexicalNode,
} from 'lexical';

import {LexicalDocNode} from '.';

export function syncDocNodeToLexical(
  doc: Doc,
  editor: LexicalEditor,
  lexicalKeyToDocNodeId: Map<string, string>,
  docNodeIdToLexicalKey: Map<string, string>,
) {
  // Sync DocNode → Lexical
  doc.onChange(() => {
    editor.update(
      () => {
        $syncDocNodeToLexical(
          doc,
          editor,
          lexicalKeyToDocNodeId,
          docNodeIdToLexicalKey,
        );
      },
      {discrete: true, tag: 'docnode'},
    );
  });
}

/**
 * Sync DocNode changes to Lexical
 * For now, uses a simple rebuild strategy - rebuild the entire tree
 * TODO: Optimize to only update changed nodes using diff algorithm
 */
function $syncDocNodeToLexical(
  doc: Doc,
  editor: LexicalEditor,
  lexicalKeyToDocNodeId: Map<string, string>,
  docNodeIdToLexicalKey: Map<string, string>,
): void {
  const lexicalRoot = $getRoot();

  // Clear existing mappings for deleted nodes
  const existingDocNodeIds = new Set<string>();
  let docChild = doc.root.first;
  while (docChild) {
    existingDocNodeIds.add(docChild.id);
    docChild = docChild.next;
  }

  // Remove mappings for deleted DocNodes
  for (const [docNodeId, lexicalKey] of docNodeIdToLexicalKey) {
    if (!existingDocNodeIds.has(docNodeId)) {
      lexicalKeyToDocNodeId.delete(lexicalKey);
      docNodeIdToLexicalKey.delete(docNodeId);
    }
  }

  // Rebuild strategy: clear and recreate
  lexicalRoot.clear();

  // Recursively create Lexical nodes from DocNode
  const createLexicalFromDocNode = (
    docNode: DocNode<typeof LexicalDocNode>,
  ): LexicalNode => {
    const serialized = docNode.state.j.get();
    const lexicalNode = $parseSerializedNode(serialized);

    // Update mappings
    lexicalKeyToDocNodeId.set(lexicalNode.getKey(), docNode.id);
    docNodeIdToLexicalKey.set(docNode.id, lexicalNode.getKey());

    // Recursively process children
    if ($isElementNode(lexicalNode)) {
      let child = docNode.first;
      while (child) {
        if (!child.is(LexicalDocNode)) {
          throw new Error('Expected child to be a LexicalDocNode');
        }
        const lexicalChild = createLexicalFromDocNode(child);
        lexicalNode.append(lexicalChild);
        child = child.next;
      }
    }

    return lexicalNode;
  };

  // Process all root children
  let docChild2 = doc.root.first;
  while (docChild2) {
    if (!docChild2.is(LexicalDocNode)) {
      throw new Error('Expected child to be a LexicalDocNode');
    }
    const lexicalNode = createLexicalFromDocNode(docChild2);
    lexicalRoot.append(lexicalNode);
    docChild2 = docChild2.next;
  }
}
