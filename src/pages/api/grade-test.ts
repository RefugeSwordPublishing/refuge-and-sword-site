export const prerender = false;

import type { APIRoute } from 'astro';
import Anthropic from '@anthropic-ai/sdk';

export const POST: APIRoute = async ({ request }) => {
  const apiKey = import.meta.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json({ error: 'Grading service not configured.' }, 500);

  const contentType = request.headers.get('content-type') || '';

  // ── Multi-image JSON path (from MultiShotCamera) ──────────────────────────
  if (contentType.includes('application/json')) {
    let body: { images?: string[]; questions?: { id: string; text: string }[] };
    try { body = await request.json(); } catch { return json({ error: 'Invalid request.' }, 400); }

    const { images, questions } = body;
    if (!images?.length || !questions?.length) return json({ error: 'images and questions are required.' }, 400);

    const questionList = questions.map((q, i) => `${i + 1}. ${q.text}`).join('\n');
    const prompt = buildPrompt(questions.length, images.length, questionList);

    const imageBlocks = images.map(b64 => ({
      type: 'image' as const,
      source: { type: 'base64' as const, media_type: 'image/jpeg' as const, data: b64 },
    }));

    try {
      const client = new Anthropic({ apiKey });
      const message = await client.messages.create({
        model: 'claude-opus-4-8',
        max_tokens: 1024,
        messages: [{ role: 'user', content: [...imageBlocks, { type: 'text', text: prompt }] }],
      });
      return parseAndReturn(message, questions.length);
    } catch (err) {
      console.error('Grading error:', err);
      return json({ error: 'Grading failed. Please try again or enter the score manually.' }, 500);
    }
  }

  // ── Single-image FormData path (legacy / fallback) ────────────────────────
  let formData: FormData;
  try { formData = await request.formData(); } catch { return json({ error: 'Invalid request.' }, 400); }

  const imageFile = formData.get('image') as File | null;
  const questionsRaw = formData.get('questions') as string | null;
  if (!imageFile || !questionsRaw) return json({ error: 'Image and questions are required.' }, 400);

  let questions: { id: string; text: string }[];
  try { questions = JSON.parse(questionsRaw); } catch { return json({ error: 'Invalid questions format.' }, 400); }
  if (!questions.length) return json({ error: 'No questions provided.' }, 400);

  const arrayBuffer = await imageFile.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString('base64');
  const mediaType = (imageFile.type || 'image/jpeg') as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
  const questionList = questions.map((q, i) => `${i + 1}. ${q.text}`).join('\n');

  try {
    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
          { type: 'text', text: buildPrompt(questions.length, 1, questionList) },
        ],
      }],
    });
    return parseAndReturn(message, questions.length);
  } catch (err) {
    console.error('Grading error:', err);
    return json({ error: 'Grading failed. Please try again or enter the score manually.' }, 500);
  }
};

function buildPrompt(questionCount: number, pageCount: number, questionList: string): string {
  const pageNote = pageCount > 1
    ? `The test is spread across ${pageCount} pages, scan ALL images for the student's answers.`
    : 'Look carefully at the student\'s handwritten answers in the image.';
  return `You are grading a student's handwritten test. ${pageNote} The test has ${questionCount} questions listed below.

QUESTIONS:
${questionList}

Grading instructions:
- Accept answers that demonstrate understanding, even if not perfectly worded
- For short-answer questions, look for the key concept
- Be fair but accurate, partial credit is not given, each is correct or incorrect
- If you cannot read the handwriting for a question, mark it incorrect

Respond with ONLY a valid JSON array, no explanation, no markdown, just the array:
[{"question": 1, "correct": true, "studentAnswer": "what they wrote", "note": ""}, ...]

Include one object per question. The "note" field is empty if correct, or a brief reason if incorrect.`;
}

function parseAndReturn(message: Anthropic.Message, total: number): Response {
  const text = message.content[0].type === 'text' ? message.content[0].text.trim() : '';
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const results: { question: number; correct: boolean; studentAnswer: string; note: string }[] = JSON.parse(cleaned);
  const totalCorrect = results.filter(r => r.correct).length;
  return json({ results, totalCorrect, total, pct: Math.round(totalCorrect / total * 100) });
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
