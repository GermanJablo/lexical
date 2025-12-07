/* eslint-disable header/header */
/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  defineNode,
  defineState,
  Doc,
  type DocNode,
  type JsonDoc,
  string,
} from 'docnode';
import {
  $getRoot,
  $isElementNode,
  $parseSerializedNode,
  createEditor,
  type CreateEditorArgs,
  type LexicalEditor,
  type LexicalNode,
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
        parentDocNode.children().forEach((child) => {
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

  return {doc, editor};
}

export const LexicalDocNode = defineNode({
  state: {
    j: defineState({
      fromJSON: (json) =>
        (json ?? {}) as SerializedLexicalNode & {[key: string]: unknown},
    }),
  },
  type: 'l',
});
