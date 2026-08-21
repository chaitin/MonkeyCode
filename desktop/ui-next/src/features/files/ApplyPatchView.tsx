import { parseApplyPatch } from "@/lib/tools/applyPatch";

export function ApplyPatchView({ text }: { text: string }) {
  const sections = parseApplyPatch(text);
  if (!sections.length) {
    return <pre className="select-text px-4 py-2 font-mono text-xs leading-relaxed whitespace-pre-wrap wrap-anywhere">{text}</pre>;
  }

  return (
    <div className="select-text space-y-2 p-2.5 font-mono text-xs leading-relaxed">
      {sections.map((section, sectionIndex) => (
        <div key={`${section.action}:${section.path}:${sectionIndex}`} className="overflow-hidden rounded-box border border-base-300 bg-base-100">
          <div className="border-b border-base-300 bg-base-200 px-3 py-1.5 text-base-content/65">
            {`${section.action} File: ${section.path}`}
          </div>
          <div className="py-1">
            {section.lines.map((line, lineIndex) => (
              <PatchLine key={lineIndex} line={line} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function PatchLine({ line }: { line: string }) {
  const kind = line.startsWith("+") ? "add" : line.startsWith("-") ? "del" : "other";
  const marked = kind !== "other" || line.startsWith(" ");
  const meta = line.startsWith("@@") || line.startsWith("***");
  const tone = kind === "add" ? "bg-success/10" : kind === "del" ? "bg-error/10" : meta ? "bg-base-200" : "";
  const markTone = kind === "add" ? "text-success" : kind === "del" ? "text-error" : "";

  return (
    <div className={`flex px-3 ${tone}`}>
      <span aria-hidden className={`w-4 shrink-0 select-none ${markTone}`}>
        {kind === "add" ? "+" : kind === "del" ? "-" : ""}
      </span>
      <span className={`min-w-0 flex-1 whitespace-pre-wrap wrap-anywhere ${meta ? "text-base-content/50" : ""}`}>
        {(marked ? line.slice(1) : line) || " "}
      </span>
    </div>
  );
}
