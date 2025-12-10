/* eslint-disable header/header */

import {docToLexical} from '@lexical/docnode';
import {Doc} from 'docnode';
import {useEffect} from 'react';

import {useLexicalComposerContext} from './LexicalComposerContext';

export function DocNodeCollabPlugin({
  onInit,
  // TODO: why cursor added providedDoc?
  doc: providedDoc,
}: {
  onInit: (doc: Doc) => void;
  doc?: Doc;
}) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    if (editor) {
      const {doc} = docToLexical(editor, providedDoc);
      onInit(doc);
    }
  }, [editor, onInit, providedDoc]);

  return null;
}
