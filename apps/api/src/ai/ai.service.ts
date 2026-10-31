import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

@Injectable()
export class AiService {
  private failures = 0;
  private circuitOpenUntil = 0;
  constructor(private readonly config: ConfigService) {}

  async complete(messages: ChatMessage[], options: { temperature?: number } = {}) {
    const key = this.config.get<string>('ANTHROPIC_API_KEY');
    if (!key) {
      const input = messages.at(-1)?.content ?? '';
      return `# 产品需求文档草稿\n\n## 背景与目标\n${input}\n\n## 方案概述\n待产品与工程团队评审。\n\n## 验收标准\n- 根据本需求验证实现结果。`;
    }
    if (Date.now() < this.circuitOpenUntil)
      throw new ServiceUnavailableException('AI 服务熔断中，请稍后重试');
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await fetch(
          `${this.config.get('ANTHROPIC_API_BASE_URL', 'https://api.anthropic.com')}/v1/messages`,
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-api-key': key,
              'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
              model: this.config.get('ANTHROPIC_MODEL', 'claude-3-5-sonnet-20241022'),
              max_tokens: 4096,
              temperature: options.temperature ?? 0.2,
              messages: messages.filter((message) => message.role !== 'system'),
              system: messages.find((message) => message.role === 'system')?.content,
            }),
          },
        );
        if (!response.ok) throw new Error(`AI request failed: ${response.status}`);
        const data = (await response.json()) as { content?: Array<{ text?: string }> };
        this.failures = 0;
        return data.content?.map((item) => item.text ?? '').join('') ?? '';
      } catch (error) {
        if (attempt === 2) {
          this.failures += 1;
          if (this.failures >= 5) this.circuitOpenUntil = Date.now() + 30_000;
          throw new ServiceUnavailableException('AI 服务暂时不可用', { cause: error as Error });
        }
        await new Promise((resolve) => setTimeout(resolve, 150 * 2 ** attempt));
      }
    }
    throw new ServiceUnavailableException('AI 服务暂时不可用');
  }

  async *stream(messages: ChatMessage[]): AsyncGenerator<string> {
    const key = this.config.get<string>('ANTHROPIC_API_KEY');
    if (!key) {
      const content = await this.complete(messages);
      for (const chunk of content.match(/.{1,80}/gs) ?? []) yield chunk;
      return;
    }
    if (Date.now() < this.circuitOpenUntil)
      throw new ServiceUnavailableException('AI 服务熔断中，请稍后重试');
    const response = await fetch(
      `${this.config.get('ANTHROPIC_API_BASE_URL', 'https://api.anthropic.com')}/v1/messages`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: this.config.get('ANTHROPIC_MODEL', 'claude-3-5-sonnet-20241022'),
          max_tokens: 4096,
          stream: true,
          messages: messages.filter((message) => message.role !== 'system'),
          system: messages.find((message) => message.role === 'system')?.content,
        }),
      },
    );
    if (!response.ok || !response.body) {
      this.failures += 1;
      if (this.failures >= 5) this.circuitOpenUntil = Date.now() + 30_000;
      throw new ServiceUnavailableException('AI 流式服务暂时不可用');
    }
    this.failures = 0;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        buffer += decoder.decode(part.value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          const event = JSON.parse(payload) as { type?: string; delta?: { text?: string } };
          if (event.type === 'content_block_delta' && event.delta?.text) yield event.delta.text;
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async embeddings(texts: string[]): Promise<number[][]> {
    const key = this.config.get<string>('OPENAI_API_KEY');
    if (!key) return texts.map((text) => this.localEmbedding(text));
    if (Date.now() < this.circuitOpenUntil)
      throw new ServiceUnavailableException('AI 服务熔断中，请稍后重试');
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await fetch(
          `${this.config.get('OPENAI_API_BASE_URL', 'https://api.openai.com/v1')}/embeddings`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
            body: JSON.stringify({
              model: this.config.get('OPENAI_EMBEDDING_MODEL', 'text-embedding-3-small'),
              input: texts,
            }),
          },
        );
        if (!response.ok) throw new Error(`Embedding request failed: ${response.status}`);
        const data = (await response.json()) as {
          data?: Array<{ index: number; embedding?: number[] }>;
        };
        this.failures = 0;
        return (data.data ?? [])
          .sort((a, b) => a.index - b.index)
          .map((item) => item.embedding ?? []);
      } catch (error) {
        if (attempt === 2) {
          this.failures += 1;
          if (this.failures >= 5) this.circuitOpenUntil = Date.now() + 30_000;
          throw new ServiceUnavailableException('Embedding 服务暂时不可用', {
            cause: error as Error,
          });
        }
        await new Promise((resolve) => setTimeout(resolve, 150 * 2 ** attempt));
      }
    }
    throw new ServiceUnavailableException('Embedding 服务暂时不可用');
  }

  async embedding(text: string) {
    return (await this.embeddings([text]))[0] ?? [];
  }

  private localEmbedding(text: string) {
    const vector = Array(64).fill(0) as number[];
    for (const term of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
      const hash = createHash('sha256').update(term).digest();
      vector[hash.readUInt32BE(0) % vector.length] += hash[4] % 2 ? 1 : -1;
    }
    const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
    return vector.map((value) => value / norm);
  }
}
