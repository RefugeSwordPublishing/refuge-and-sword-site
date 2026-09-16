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

  // Lowest grade in the range (K counts as 0). Used to tell whether the student can read yet.
  const gradeNum = (() => {
    const m = String(grade).toLowerCase().match(/k|\d+/);
    if (!m) return 5;
    return m[0] === 'k' ? 0 : parseInt(m[0], 10);
  })();
  const earlyMath = isMath && gradeNum <= 2;

  let prompt: string;
  if (isMath) {
    // Math is a practice sheet of problems to solve, not written or word questions.
    prompt = `Generate ${count} math practice problems for a homeschool student working on "${label}" at grade ${grade} level.

Subject: ${subject}
Skill description: ${desc || label}

Rules:
- Each item is a MATH PROBLEM to SOLVE, written exactly as it should appear on a worksheet. This is a math practice sheet, not a set of written or word questions.
- Match every problem to this specific skill: ${label} (${desc || label}). Do not drift to other math topics.
- Vary the problems so they are not all identical. With many problems some answers will naturally repeat, which is fine.
- Provide the correct answer for every problem.${earlyMath
      ? '\n- This student is too young to read. Use ONLY numbers and math symbols, with no words and no instructions. Write each problem as an equation ending in "=", for example "7 + 4 =".'
      : '\n- Keep problems computation-focused: equations or expressions to solve. A few short word problems are acceptable, but most items should be symbolic math.'}

Respond with ONLY a valid JSON array, no explanation, no markdown:
[{"text": "7 + 4 =", "answer": "11"}, ...]

Generate exactly ${count} problems.`;
  } else {
    const handsOnNote = isHandsOn
      ? '\n- For hands-on skills: include "describe how you would..." or "what steps would you take to..." style questions alongside knowledge questions.'
      : '';
    prompt = `Generate ${count} mastery test questions for a homeschool student studying "${label}" at grade ${grade} level.

Subject: ${subject}
Topic description: ${desc || label}

Rules:
- Test genuine understanding, not just memorization
- Use language and complexity appropriate for grade ${grade}
- Mix question types: recall, application, and short-answer explanation
- Keep each question to one clear sentence${handsOnNote}
- These are open-ended written or spoken answer questions, no multiple choice

Respond with ONLY a valid JSON array, no explanation, no markdown:
[{"text": "question text here"}, ...]

Generate exactly ${count} questions.`;
  }

  try {
    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = message.content[0].type === 'text' ? message.content[0].text.trim() : '';
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    const questions: { text: string; answer?: string }[] = JSON.parse(cleaned);

    const result = questions.map((q, i) => ({
      id: `gen_${Date.now()}_${i}`,
      text: q.text,
      ...(q.answer != null && String(q.answer) !== '' ? { answer: String(q.answer) } : {}),
    }));
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
