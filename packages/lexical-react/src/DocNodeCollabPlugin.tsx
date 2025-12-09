/* eslint-disable header/header */

import {docToLexical} from '@lexical/docnode';
import {Doc} from 'docnode';
import {useEffect} from 'react';

import {useLexicalComposerContext} from './LexicalComposerContext';

export function DocNodeCollabPlugin({onInit}: {onInit: (doc: Doc) => void}) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    if (editor) {
      const {doc} = docToLexical(editor);
      onInit(doc);
    }
  }, [editor, onInit]);

  return null;
}
