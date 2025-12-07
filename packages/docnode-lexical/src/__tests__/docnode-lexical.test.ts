/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import {docToLexical, LexicalDocNode} from '@docnode/lexical';
import {Doc} from 'docnode';
import {type SerializedParagraphNode, type SerializedTextNode} from 'lexical';
import {describe, expect, test} from 'vitest';

import {assertJson} from '../docnode/utils.js';

describe('docnode to lexical', () => {
  test('no doc provided', () => {
    const {editor, doc} = docToLexical({
      namespace: 'MyEditor',
      onError: (error) => {
        console.error(error);
      },
    });
    expect(doc).toBeInstanceOf(Doc);
    const jsonEditorState = editor.getEditorState().toJSON();
    expect(jsonEditorState).toStrictEqual({
      root: {
        children: [],
        direction: null,
        format: '',
        indent: 0,
        type: 'root',
        version: 1,
      },
    });
    const rootJson = JSON.stringify(jsonEditorState.root);
    expect(rootJson).toStrictEqual(
      '{"children":[],"direction":null,"format":"","indent":0,"type":"root","version":1}',
    );
    assertJson(doc, ['root', {}, [['l', {j: rootJson}]]]);
  });

  test('doc provided', () => {
    const doc = new Doc({extensions: [{nodes: [LexicalDocNode]}]});
    const paragraphJson: SerializedParagraphNode = {
      children: [],
      direction: 'ltr',
      format: '',
      indent: 0,
      textFormat: 0,
      textStyle: '',
      type: 'paragraph',
      version: 1,
    };
    const textJson: SerializedTextNode = {
      detail: 0,
      format: 0,
      mode: 'normal',
      style: '',
      text: 'Hello, world!',
      type: 'text',
      version: 1,
    };

    const dnParagraph1 = doc.createNode(LexicalDocNode);
    const dnParagraph2 = doc.createNode(LexicalDocNode);
    const dnText1 = doc.createNode(LexicalDocNode);
    const dnText2 = doc.createNode(LexicalDocNode);

    dnParagraph1.state.j.set(paragraphJson);
    dnParagraph2.state.j.set(paragraphJson);
    dnText1.state.j.set(textJson);
    dnText2.state.j.set(textJson);

    dnParagraph1.append(dnText1);
    dnParagraph2.append(dnText2);
    doc.root.append(dnParagraph1, dnParagraph2);

    assertJson(doc, [
      'root',
      {},
      [
        [
          'l',
          {j: JSON.stringify(paragraphJson)},
          [['l', {j: JSON.stringify(textJson)}]],
        ],
        [
          'l',
          {j: JSON.stringify(paragraphJson)},
          [['l', {j: JSON.stringify(textJson)}]],
        ],
      ],
    ]);

    const {editor} = docToLexical(
      {
        namespace: 'MyEditor',
        onError: (error) => {
          console.error(error);
        },
      },
      doc,
    );
    expect(doc).toBeInstanceOf(Doc);
    const jsonEditorState = editor.getEditorState().toJSON();
    expect(jsonEditorState).toStrictEqual({
      root: {
        children: [
          {
            ...paragraphJson,
            children: [textJson],
          },
          {
            ...paragraphJson,
            children: [textJson],
          },
        ],
        direction: null,
        format: '',
        indent: 0,
        type: 'root',
        version: 1,
      },
    });
  });
});
