export const prerender = false;

import type { APIRoute } from 'astro';
import Anthropic from '@anthropic-ai/sdk';

export const POST: APIRoute = async ({ request }) => {
  const apiKey = import.meta.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return json({ error: 'Test generation not configured.' }, 500);
  }

  let body: { label?: string; desc?: string; grade?: string; subject?: string; count?: number };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid request.' }, 400);
  }

  const { label, desc, grade, subject, count = 10 } = body;
  if (!label || !grade || !subject) {
    return json({ error: 'label, grade, and subject are required.' }, 400);
  }

  const isMath = subject.toLowerCase().includes('math');
  const isHandsOn = ['life skills', 'life_skills'].some(s => subject.toLowerCase().includes(s));

  const mathNote = isMath
    ? '\n- CRITICAL for math: every question must have a DIFFERENT numerical answer. Vary the numbers widely so answers are spread across a broad range — never repeat the same result twice.'
    : '';

  const handsOnNote = isHandsOn
    ? '\n- For hands-on skills: include "describe how you would..." or "what steps would you take to..." style questions alongside knowledge questions.'
    : '';

  const prompt = `Generate ${count} mastery test questions for a homeschool student studying "${label}" at grade ${grade} level.

Subject: ${subject}
Topic description: ${desc || label}

Rules:
- Test genuine understanding, not just memorization
- Use language and complexity appropriate for grade ${grade}
- Mix question types: recall, application, and short-answer explanation
- Keep each question to one clear sentence${mathNote}${handsOnNote}
- These are open-ended written or spoken answer questions — no multiple choice

Respond with ONLY a valid JSON array, no explanation, no markdown:
[{"text": "question text here"}, ...]

Generate exactly ${count} questions.`;

  try {
    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = message.content[0].type === 'text' ? message.content[0].text.trim() : '';
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    const questions: { text: string }[] = JSON.parse(cleaned);

    const result = questions.map((q, i) => ({ id: `gen_${Date.now()}_${i}`, text: q.text }));
    return json({ questions: result });
  } catch (err) {
    console.error('Generation error:', err);
    return json({ error: 'Failed to generate questions. Please try again.' }, 500);
  }
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
