import hljs from "highlight.js";
import { marked } from "marked";

// Configure marked with syntax highlighting
marked.setOptions({
	gfm: true,
	breaks: true,
});

// Custom renderer for code blocks with syntax highlighting
const renderer = new marked.Renderer();

renderer.code = ({ text, lang }) => {
	const language = lang && hljs.getLanguage(lang) ? lang : "plaintext";
	const highlighted = hljs.highlight(text, { language }).value;
	return `<pre class="hljs rounded-lg overflow-x-auto"><code class="language-${language}">${highlighted}</code></pre>`;
};

renderer.codespan = ({ text }) => {
	return `<code class="inline-code">${text}</code>`;
};

marked.use({ renderer });

export function useMarkdown() {
	const renderMarkdown = (content: string): string => {
		if (!content) return "";

		try {
			const result = marked.parse(content);
			// marked.parse can return string | Promise<string>, but with sync options it's always string
			return typeof result === "string" ? result : "";
		} catch (err) {
			console.error("Markdown parsing error:", err);
			return content;
		}
	};

	return {
		renderMarkdown,
	};
}
