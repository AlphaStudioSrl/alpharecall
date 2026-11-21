import { Streamdown, defaultRemarkPlugins, type StreamdownProps } from "streamdown";

type MarkdownNode = {
  type: string;
  children?: MarkdownNode[];
};

// Preserve raw HTML as visible text before rehype's HTML parser/sanitizer can
// interpret or discard it. Code nodes already have literal-text semantics.
function literalHtml() {
  return (tree: MarkdownNode) => {
    function visit(node: MarkdownNode) {
      if (node.type === "html") node.type = "text";
      node.children?.forEach(visit);
    }
    visit(tree);
  };
}

const remarkPlugins = [...Object.values(defaultRemarkPlugins), literalHtml];

export function SafeMarkdown(props: StreamdownProps) {
  return <Streamdown {...props} remarkPlugins={remarkPlugins} />;
}
