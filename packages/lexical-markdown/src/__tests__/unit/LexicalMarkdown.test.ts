/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

import {$createCodeNode, CodeNode} from '@lexical/code';
import {createHeadlessEditor} from '@lexical/headless';
import {$generateHtmlFromNodes, $generateNodesFromDOM} from '@lexical/html';
import {LinkNode} from '@lexical/link';
import {ListItemNode, ListNode} from '@lexical/list';
import {HeadingNode, QuoteNode} from '@lexical/rich-text';
import {$createTextNode, $getRoot, $insertNodes} from 'lexical';

import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  LINK,
  TextMatchTransformer,
  Transformer,
  TRANSFORMERS,
} from '../..';
import {
  MultilineElementTransformer,
  normalizeMarkdown,
} from '../../MarkdownTransformers';

// Matches html within a mdx file
const MDX_HTML_TRANSFORMER: MultilineElementTransformer = {
  dependencies: [CodeNode],
  export: (node) => {
    if (node.getTextContent().startsWith('From HTML:')) {
      return `<MyComponent>${node
        .getTextContent()
        .replace('From HTML: ', '')}</MyComponent>`;
    }
    return null; // Run next transformer
  },
  regExpEnd: /<\/(\w+)\s*>/,
  regExpStart: /<(\w+)[^>]*>/,
  replace: (rootNode, children, startMatch, endMatch, linesInBetween) => {
    if (!linesInBetween) {
      return false; // Run next transformer. We don't need to support markdown shortcuts for this test
    }
    if (startMatch[1] === 'MyComponent') {
      const codeBlockNode = $createCodeNode(startMatch[1]);
      const textNode = $createTextNode(
        'From HTML: ' + linesInBetween.join('\n'),
      );
      codeBlockNode.append(textNode);
      rootNode.append(codeBlockNode);
      return;
    }
    return false; // Run next transformer
  },
  type: 'multilineElement',
};

describe('Markdown', () => {
  type Input = Array<{
    html: string;
    md: string;
    skipExport?: true;
    skipImport?: true;
    shouldPreserveNewLines?: true;
    customTransformers?: Transformer[];
  }>;

  const URL = 'https://lexical.dev';

  const IMPORT_AND_EXPORT: Input = [
    {
      html: '<h1><span style="white-space: pre-wrap;">Hello world</span></h1>',
      md: '# Hello world',
    },
    {
      html: '<h2><span style="white-space: pre-wrap;">Hello world</span></h2>',
      md: '## Hello world',
    },
    {
      html: '<h3><span style="white-space: pre-wrap;">Hello world</span></h3>',
      md: '### Hello world',
    },
    {
      html: '<h4><span style="white-space: pre-wrap;">Hello world</span></h4>',
      md: '#### Hello world',
    },
    {
      html: '<h5><span style="white-space: pre-wrap;">Hello world</span></h5>',
      md: '##### Hello world',
    },
    {
      html: '<h6><span style="white-space: pre-wrap;">Hello world</span></h6>',
      md: '###### Hello world',
    },
    {
      // Multiline paragraphs: https://spec.commonmark.org/dingus/?text=Hello%0Aworld%0A!
      html: '<p><span style="white-space: pre-wrap;">Helloworld!</span></p>',
      md: ['Hello', 'world', '!'].join('\n'),
      skipExport: true,
    },
    {
      // Multiline paragraphs
      // TO-DO: It would be nice to support also hard line breaks (<br>) as \ or double spaces
      // See https://spec.commonmark.org/0.31.2/#hard-line-breaks.
      // Example: '<p><span style="white-space: pre-wrap;">Hello\\\nworld\\\n!</span></p>',
      html: '<p><span style="white-space: pre-wrap;">Hello<br>world<br>!</span></p>',
      md: ['Hello', 'world', '!'].join('\n'),
      skipImport: true,
    },
    {
      html: '<blockquote><span style="white-space: pre-wrap;">Hello</span><br><span style="white-space: pre-wrap;">world!</span></blockquote>',
      md: '> Hello\n> world!',
    },
    // TO-DO: <br> should be preserved
    // {
    //   html: '<ul><li value="1"><span style="white-space: pre-wrap;">Hello</span></li><li value="2"><span style="white-space: pre-wrap;">world<br>!<br>!</span></li></ul>',
    //   md: '- Hello\n- world<br>!<br>!',
    //   skipImport: true,
    // },
    {
      // Multiline list items: https://spec.commonmark.org/dingus/?text=-%20Hello%0A-%20world%0A!%0A!
      html: '<ul><li value="1"><span style="white-space: pre-wrap;">Hello</span></li><li value="2"><span style="white-space: pre-wrap;">world!!</span></li></ul>',
      md: '- Hello\n- world\n!\n!',
      skipExport: true,
    },
    {
      html: '<ul><li value="1"><span style="white-space: pre-wrap;">Hello</span></li><li value="2"><span style="white-space: pre-wrap;">world</span></li></ul>',
      md: '- Hello\n- world',
    },
    {
      html: '<ul><li value="1"><span style="white-space: pre-wrap;">Level 1</span></li><li value="2"><ul><li value="1"><span style="white-space: pre-wrap;">Level 2</span></li><li value="2"><ul><li value="1"><span style="white-space: pre-wrap;">Level 3</span></li></ul></li></ul></li></ul><p><span style="white-space: pre-wrap;">Hello world</span></p>',
      md: '- Level 1\n    - Level 2\n        - Level 3\n\nHello world',
    },
    // List indentation with tabs, Import only: export will use "    " only for one level of indentation
    {
      html: '<ul><li value="1"><span style="white-space: pre-wrap;">Level 1</span></li><li value="2"><ul><li value="1"><span style="white-space: pre-wrap;">Level 2</span></li><li value="2"><ul><li value="1"><span style="white-space: pre-wrap;">Level 3</span></li></ul></li></ul></li></ul><p><span style="white-space: pre-wrap;">Hello world</span></p>',
      md: '- Level 1\n\t- Level 2\n  \t  - Level 3\n\nHello world',
      skipExport: true,
    },
    {
      // Import only: export will use "-" instead of "*"
      html: '<ul><li value="1"><span style="white-space: pre-wrap;">Level 1</span></li><li value="2"><ul><li value="1"><span style="white-space: pre-wrap;">Level 2</span></li><li value="2"><ul><li value="1"><span style="white-space: pre-wrap;">Level 3</span></li></ul></li></ul></li></ul><p><span style="white-space: pre-wrap;">Hello world</span></p>',
      md: '* Level 1\n    * Level 2\n        * Level 3\n\nHello world',
      skipExport: true,
    },
    {
      html: '<ol><li value="1"><span style="white-space: pre-wrap;">Hello</span></li><li value="2"><span style="white-space: pre-wrap;">world</span></li></ol>',
      md: '1. Hello\n2. world',
    },
    {
      html: '<ol start="25"><li value="25"><span style="white-space: pre-wrap;">Hello</span></li><li value="26"><span style="white-space: pre-wrap;">world</span></li></ol>',
      md: '25. Hello\n26. world',
    },
    {
      html: '<p><i><em style="white-space: pre-wrap;">Hello</em></i><span style="white-space: pre-wrap;"> world</span></p>',
      md: '*Hello* world',
    },
    {
      html: '<p><b><strong style="white-space: pre-wrap;">Hello</strong></b><span style="white-space: pre-wrap;"> world</span></p>',
      md: '**Hello** world',
    },
    {
      html: '<p><i><b><strong style="white-space: pre-wrap;">Hello</strong></b></i><span style="white-space: pre-wrap;"> world</span></p>',
      md: '***Hello*** world',
    },
    {
      html: '<p><code spellcheck="false" style="white-space: pre-wrap;"><span>Hello</span></code><span style="white-space: pre-wrap;"> world</span></p>',
      md: '`Hello` world',
    },
    {
      html: '<p><s><span style="white-space: pre-wrap;">Hello</span></s><span style="white-space: pre-wrap;"> world</span></p>',
      md: '~~Hello~~ world',
    },
    {
      html: '<p><code spellcheck="false" style="white-space: pre-wrap;"><span>hello$</span></code></p>',
      md: '`hello$`',
    },
    {
      html: '<p><code spellcheck="false" style="white-space: pre-wrap;"><span>$$hello</span></code></p>',
      md: '`$$hello`',
    },
    {
      html: '<p><a href="https://lexical.dev"><span style="white-space: pre-wrap;">Hello</span></a><span style="white-space: pre-wrap;"> world</span></p>',
      md: '[Hello](https://lexical.dev) world',
    },
    {
      html: '<p><a href="https://lexical.dev" title="Hello world"><span style="white-space: pre-wrap;">Hello</span></a><span style="white-space: pre-wrap;"> world</span></p>',
      md: '[Hello](https://lexical.dev "Hello world") world',
    },
    {
      html: '<p><a href="https://lexical.dev" title="Title with \\&quot; escaped character"><span style="white-space: pre-wrap;">Hello</span></a><span style="white-space: pre-wrap;"> world</span></p>',
      md: '[Hello](https://lexical.dev "Title with \\" escaped character") world',
    },
    {
      html: '<p><span style="white-space: pre-wrap;">Hello </span><s><i><b><strong style="white-space: pre-wrap;">world</strong></b></i></s><span style="white-space: pre-wrap;">!</span></p>',
      md: 'Hello ~~***world***~~!',
    },
    {
      html: '<p><i><em style="white-space: pre-wrap;">Hello </em></i><i><b><strong style="white-space: pre-wrap;">world</strong></b></i><i><em style="white-space: pre-wrap;">!</em></i></p>',
      md: '*Hello **world**!*',
    },
    {
      html: '<h1><span style="white-space: pre-wrap;">Hello</span></h1><p><br></p><p><br></p><p><br></p><p><b><strong style="white-space: pre-wrap;">world</strong></b><span style="white-space: pre-wrap;">!</span></p>',
      md: '# Hello\n\n\n\n**world**!',
      shouldPreserveNewLines: true,
    },
    {
      html: '<h1><span style="white-space: pre-wrap;">Hello</span></h1><p><span style="white-space: pre-wrap;">hi</span></p><p><br></p><p><b><strong style="white-space: pre-wrap;">world</strong></b></p><p><br></p><p><span style="white-space: pre-wrap;">hi</span></p><blockquote><span style="white-space: pre-wrap;">hello</span><br><span style="white-space: pre-wrap;">hello</span></blockquote><p><br></p><h1><span style="white-space: pre-wrap;">hi</span></h1><p><br></p><p><span style="white-space: pre-wrap;">hi</span></p>',
      md: '# Hello\nhi\n\n**world**\n\nhi\n> hello\n> hello\n\n# hi\n\nhi',
      shouldPreserveNewLines: true,
    },
    {
      // Import only: export will use * instead of _ due to registered transformers order
      html: '<p><i><em style="white-space: pre-wrap;">Hello</em></i><span style="white-space: pre-wrap;"> world</span></p>',
      md: '_Hello_ world',
      skipExport: true,
    },
    {
      // Import only: export will use * instead of _ due to registered transformers order
      html: '<p><b><strong style="white-space: pre-wrap;">Hello</strong></b><span style="white-space: pre-wrap;"> world</span></p>',
      md: '__Hello__ world',
      skipExport: true,
    },
    {
      // Import only: export will use * instead of _ due to registered transformers order
      html: '<p><i><b><strong style="white-space: pre-wrap;">Hello</strong></b></i><span style="white-space: pre-wrap;"> world</span></p>',
      md: '___Hello___ world',
      skipExport: true,
    },
    {
      // Import only: export will use * instead of _ due to registered transformers order
      html: '<p><span style="white-space: pre-wrap;">Hello </span><s><i><b><strong style="white-space: pre-wrap;">world</strong></b></i></s><span style="white-space: pre-wrap;">!</span></p>',
      md: 'Hello ~~__*world*__~~!',
      skipExport: true,
    },
    {
      html: '<pre spellcheck="false"><span style="white-space: pre-wrap;">Single line Code</span></pre>',
      md: '```Single line Code```', // Ensure that "Single" is not read as the language by the code transformer. It should only be read as the language if there is a multi-line code block
      skipExport: true, // Export will fail, as the code transformer will add new lines to the code block to make it multi-line. This is expected though, as the lexical code block is a block node and cannot be inline.
    },
    {
      html: '<pre spellcheck="false" data-language="javascript" data-highlight-language="javascript"><span style="white-space: pre-wrap;">Incomplete tag</span></pre>',
      md: '```javascript Incomplete tag',
      skipExport: true,
    },
    {
      html:
        '<pre spellcheck="false" data-language="javascript" data-highlight-language="javascript"><span style="white-space: pre-wrap;">Incomplete multiline\n' +
        '\n' +
        'Tag</span></pre>',
      md: '```javascript Incomplete multiline\n\nTag',
      skipExport: true,
    },
    {
      html: '<pre spellcheck="false"><span style="white-space: pre-wrap;">Code</span></pre>',
      md: '```\nCode\n```',
    },
    {
      html: '<pre spellcheck="false" data-language="javascript" data-highlight-language="javascript"><span style="white-space: pre-wrap;">Code</span></pre>',
      md: '```javascript\nCode\n```',
    },
    {
      // Should always preserve language in md but keep data-highlight-language only for supported languages
      html: '<pre spellcheck="false" data-language="unknown"><span style="white-space: pre-wrap;">Code</span></pre>',
      md: '```unknown\nCode\n```',
    },
    {
      // Import only: prefix tabs will be removed for export
      html: '<pre spellcheck="false"><span style="white-space: pre-wrap;">Code</span></pre>',
      md: '\t```\nCode\n```',
      skipExport: true,
    },
    {
      // Import only: prefix spaces will be removed for export
      html: '<pre spellcheck="false"><span style="white-space: pre-wrap;">Code</span></pre>',
      md: '   ```\nCode\n```',
      skipExport: true,
    },
    {
      html: `<h3><span style="white-space: pre-wrap;">Code blocks</span></h3><pre spellcheck="false" data-language="javascript" data-highlight-language="javascript"><span style="white-space: pre-wrap;">1 + 1 = 2;</span></pre>`,
      md: `### Code blocks

\`\`\`javascript
1 + 1 = 2;
\`\`\``,
    },
    {
      // Import only: extra empty lines will be removed for export
      html: '<p><span style="white-space: pre-wrap;">Hello</span></p><p><span style="white-space: pre-wrap;">world</span></p>',
      md: ['Hello', '', '', '', 'world'].join('\n'),
      skipExport: true,
    },
    {
      // https://spec.commonmark.org/dingus/?text=%3E%20Hello%0Aworld%0A!
      html: '<blockquote><span style="white-space: pre-wrap;">Helloworld!</span></blockquote>',
      md: '> Hello\nworld\n!',
      skipExport: true,
    },
    {
      // Import only: ensures that left side of splitText is processed for text match transformers
      html: '<p><span style="white-space: pre-wrap;">Hello </span><a href="https://lexical.dev"><span style="white-space: pre-wrap;">world</span></a><span style="white-space: pre-wrap;">! Hello </span><mark style="white-space: pre-wrap;"><span>$world$</span></mark><span style="white-space: pre-wrap;">! </span><a href="https://lexical.dev"><span style="white-space: pre-wrap;">Hello</span></a><span style="white-space: pre-wrap;"> world! Hello </span><mark style="white-space: pre-wrap;"><span>$world$</span></mark><span style="white-space: pre-wrap;">!</span></p>',
      md: `Hello [world](${URL})! Hello $world$! [Hello](${URL}) world! Hello $world$!`,
      skipExport: true,
    },
    {
      // Export only: import will use $...$ to transform <span /> to <mark /> due to HIGHLIGHT_TEXT_MATCH_IMPORT
      html: "<p><span style='white-space: pre-wrap;'>$$H$&e$`l$'l$o$</span></p>",
      md: "$$H$&e$`l$'l$o$",
      skipImport: true,
    },
    {
      customTransformers: [MDX_HTML_TRANSFORMER],
      html: '<p><span style="white-space: pre-wrap;">Some HTML in mdx:</span></p><pre spellcheck="false" data-language="MyComponent"><span style="white-space: pre-wrap;">From HTML: Some Text</span></pre>',
      md: 'Some HTML in mdx:\n\n<MyComponent>Some Text</MyComponent>',
    },
    {
      customTransformers: [MDX_HTML_TRANSFORMER],
      html: '<p><span style="white-space: pre-wrap;">Some HTML in mdx:</span></p><pre spellcheck="false" data-language="MyComponent"><span style="white-space: pre-wrap;">From HTML: Line 1Some Text</span></pre>',
      md: 'Some HTML in mdx:\n\n<MyComponent>Line 1\nSome Text</MyComponent>',
      skipExport: true,
    },
  ];

  const HIGHLIGHT_TEXT_MATCH_IMPORT: TextMatchTransformer = {
    ...LINK,
    importRegExp: /\$([^$]+?)\$/,
    replace: (textNode) => {
      textNode.setFormat('highlight');
    },
  };

  for (const {
    html,
    md,
    skipImport,
    shouldPreserveNewLines,
    customTransformers,
  } of IMPORT_AND_EXPORT) {
    if (skipImport) {
      continue;
    }

    it(`can import "${md.replace(/\n/g, '\\n')}"`, () => {
      const editor = createHeadlessEditor({
        nodes: [
          HeadingNode,
          ListNode,
          ListItemNode,
          QuoteNode,
          CodeNode,
          LinkNode,
        ],
      });

      editor.update(
        () =>
          $convertFromMarkdownString(
            md,
            [
              ...(customTransformers || []),
              ...TRANSFORMERS,
              HIGHLIGHT_TEXT_MATCH_IMPORT,
            ],
            undefined,
            shouldPreserveNewLines,
          ),
        {
          discrete: true,
        },
      );

      expect(
        editor.getEditorState().read(() => $generateHtmlFromNodes(editor)),
      ).toBe(html);
    });
  }

  for (const {
    html,
    md,
    skipExport,
    shouldPreserveNewLines,
    customTransformers,
  } of IMPORT_AND_EXPORT) {
    if (skipExport) {
      continue;
    }

    it(`can export "${md.replace(/\n/g, '\\n')}"`, () => {
      const editor = createHeadlessEditor({
        nodes: [
          HeadingNode,
          ListNode,
          ListItemNode,
          QuoteNode,
          CodeNode,
          LinkNode,
        ],
      });

      editor.update(
        () => {
          const parser = new DOMParser();
          const dom = parser.parseFromString(html, 'text/html');
          const nodes = $generateNodesFromDOM(editor, dom);
          $getRoot().select();
          $insertNodes(nodes);
        },
        {
          discrete: true,
        },
      );

      expect(
        editor
          .getEditorState()
          .read(() =>
            $convertToMarkdownString(
              [...(customTransformers || []), ...TRANSFORMERS],
              undefined,
              shouldPreserveNewLines,
            ),
          ),
      ).toBe(md);
    });
  }
});

describe('normalizeMarkdown', () => {
  it('should combine lines separated by a single \n unless they are in a codeblock', () => {
    const markdown = `
A1
A2

A3

\`\`\`md
B1
B2

B3
\`\`\`

C1
C2

C3

\`\`\`js
D1
D2

D3
\`\`\`

\`\`\`single line code\`\`\`

E1
E2

E3
`;
    expect(normalizeMarkdown(markdown)).toBe(`
A1A2

A3

\`\`\`md
B1
B2

B3
\`\`\`

C1C2

C3

\`\`\`js
D1
D2

D3
\`\`\`

\`\`\`single line code\`\`\`

E1E2

E3
`);
  });

  it('tables', () => {
    const markdown = `
| a | b |
| --- | --- |
| c | d |
`;
    expect(normalizeMarkdown(markdown)).toBe(markdown);
  });
});
