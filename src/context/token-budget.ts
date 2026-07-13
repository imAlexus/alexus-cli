export function estimateTokens(value: string): number {
  return Math.ceil(Buffer.byteLength(value, "utf8") / 4);
}

export function truncateToTokenBudget(value: string, maxTokens: number): string {
  if (estimateTokens(value) <= maxTokens) return value;
  const maxBytes = Math.max(0, maxTokens * 4 - 80);
  let truncated = value.slice(0, maxBytes);
  while (Buffer.byteLength(truncated, "utf8") > maxBytes) truncated = truncated.slice(0, -1);
  return `${truncated}\n… contenuto troncato per rispettare il budget token`;
}

export class ContextBudget {
  private readonly sections: string[] = [];
  private used = 0;
  private wasTruncated = false;

  constructor(readonly maxTokens: number) {}

  add(title: string, content: string, maxSectionTokens = this.maxTokens): boolean {
    const remaining = this.maxTokens - this.used;
    if (remaining <= 16) {
      this.wasTruncated = true;
      return false;
    }
    const section = `## ${title}\n${content}`;
    const sectionLimit = Math.min(remaining, maxSectionTokens);
    const fitted = truncateToTokenBudget(section, sectionLimit);
    if (estimateTokens(section) > sectionLimit) this.wasTruncated = true;
    const tokens = estimateTokens(fitted);
    if (tokens > remaining) {
      this.wasTruncated = true;
      return false;
    }
    this.sections.push(fitted);
    this.used += tokens;
    return true;
  }

  result(): { content: string; usedTokens: number; maxTokens: number; truncated: boolean } {
    return {
      content: this.sections.join("\n\n"),
      usedTokens: this.used,
      maxTokens: this.maxTokens,
      truncated: this.wasTruncated,
    };
  }
}
