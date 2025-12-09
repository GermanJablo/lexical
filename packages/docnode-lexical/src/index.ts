/* eslint-disable curly */

import {defineNode, defineState, Doc, type DocNode} from 'docnode';
import {
  $getRoot,
  $isElementNode,
  $parseSerializedNode,
  createEditor,
  type CreateEditorArgs,
  isLexicalEditor,
  type LexicalEditor,
  type LexicalNode,
  type SerializedLexicalNode,
} from 'lexical';

import {syncDocNodeToLexical} from './syncDocNodeToLexical';
import {syncLexicalToDocNode} from './syncLexicalToDocNode';

/**
 *
 * @param editorOrConfig - A Lexical editor instance or a CreateEditorArgs object.
 * @param doc - A DocNode document instance. If no doc is provided, it will create a new one.
 * @returns A Lexical editor and DocNode document instance.
 */
export function docToLexical(
  editorOrConfig: LexicalEditor | CreateEditorArgs,
  doc = new Doc({extensions: [{nodes: [LexicalDocNode]}]}),
): {editor: LexicalEditor; doc: Doc} {
  const lexicalKeyToDocNodeId = new Map<string, string>();
  const docNodeIdToLexicalKey = new Map<string, string>();

  const editor = isLexicalEditor(editorOrConfig)
    ? editorOrConfig
    : createEditor(editorOrConfig);

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

  syncLexicalToDocNode(
    doc,
    editor,
    lexicalKeyToDocNodeId,
    docNodeIdToLexicalKey,
  );

  syncDocNodeToLexical(
    doc,
    editor,
    lexicalKeyToDocNodeId,
    docNodeIdToLexicalKey,
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
