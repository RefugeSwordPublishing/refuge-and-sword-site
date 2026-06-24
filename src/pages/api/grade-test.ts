export const prerender = false;

import type { APIRoute } from 'astro';
import Anthropic from '@anthropic-ai/sdk';

export const POST: APIRoute = async ({ request }) => {
  const apiKey = import.meta.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return json({ error: 'Grading service not configured.' }, 500);
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return json({ error: 'Invalid request.' }, 400);
  }

  const imageFile = formData.get('image') as File | null;
  const questionsRaw = formData.get('questions') as string | null;

  if (!imageFile || !questionsRaw) {
    return json({ error: 'Image and questions are required.' }, 400);
  }

  let questions: { id: string; text: string }[];
  try {
    questions = JSON.parse(questionsRaw);
  } catch {
    return json({ error: 'Invalid questions format.' }, 400);
  }

  if (!questions.length) {
    return json({ error: 'No questions provided.' }, 400);
  }

  // Convert image to base64
  const arrayBuffer = await imageFile.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString('base64');
  const mediaType = (imageFile.type || 'image/jpeg') as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';

  const questionList = questions.map((q, i) => `${i + 1}. ${q.text}`).join('\n');

  const prompt = `You are grading a student's handwritten test paper. The test has ${questions.length} questions listed below. Look carefully at the student's handwritten answers in the image and grade each one.

QUESTIONS:
${questionList}

Grading instructions:
- Accept answers that demonstrate understanding, even if not perfectly worded
- For short-answer questions, look for the key concept
- Be fair but accurate — partial credit is not given, each is correct or incorrect
- If you cannot read the handwriting for a question, mark it incorrect

Respond with ONLY a valid JSON array — no explanation, no markdown, just the array:
[{"question": 1, "correct": true, "studentAnswer": "what they wrote", "note": ""}, ...]

Include one object per question. The "note" field should be empty if correct, or a brief reason if incorrect.`;

  try {
    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: base64 },
            },
            { type: 'text', text: prompt },
          ],
        },
      ],
    });

    const text = message.content[0].type === 'text' ? message.content[0].text.trim() : '';

    // Strip markdown code fences if model wrapped the JSON
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    const results: { question: number; correct: boolean; studentAnswer: string; note: string }[] = JSON.parse(cleaned);

    const totalCorrect = results.filter(r => r.correct).length;
    const pct = Math.round((totalCorrect / questions.length) * 100);

    return json({ results, totalCorrect, total: questions.length, pct });
  } catch (err) {
    console.error('Grading error:', err);
    return json({ error: 'Grading failed. Please try again or enter the score manually.' }, 500);
  }
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
