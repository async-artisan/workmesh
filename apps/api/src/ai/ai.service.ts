import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';

@Injectable()
export class AiService {
  private failures = 0;
  private circuitOpenUntil = 0;
  constructor(private readonly config: ConfigService) {}

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
