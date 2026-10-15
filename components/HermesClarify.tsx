"use client";
import { useState } from "react";
import { useHermesI18n } from "@/hooks/useHermesI18n";
import { ConfigButton, ConfigNotice } from "./SettingsUi";

export type ClarifyRequest = { request_id: string; question?: string; choices?: string[]; questions?: { qid: string; question: string; choices?: string[]; multi_select?: boolean }[]; answers?: Record<string, string | null> };
export function HermesClarify({ request, onAnswer }: { request: ClarifyRequest; onAnswer: (answers: Record<string, string | null>) => Promise<void> }) {
  const { ht } = useHermesI18n();
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [text, setText] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const questions = request.questions?.length ? request.questions : [{ qid: "question", question: request.question || ht("请补充信息"), choices: request.choices, multi_select: false }];
  const bare = (choice: string) => choice.replace(/\s*\(Recommended\)$/, "");
  const answers = Object.fromEntries(questions.map(question => {
    if (request.answers && Object.hasOwn(request.answers, question.qid)) return [question.qid, request.answers[question.qid]];
    const picked = (selected[question.qid] ?? []).map(bare), custom = text[question.qid]?.trim();
    if (question.multi_select) return [question.qid, picked.length || custom ? JSON.stringify([...picked, ...(custom ? [custom] : [])]) : null];
    return [question.qid, custom || picked[0] || null];
  }));
  async function submit(skip = false) {
    setBusy(true); setError("");
    try { await onAnswer(skip ? {} : answers); } catch (e) { setError(e instanceof Error ? e.message : String(e)); setBusy(false); }
  }
  return <form className="hermes-clarify" aria-label={ht("补充信息")} onSubmit={event => { event.preventDefault(); void submit(); }} onKeyDown={event => event.stopPropagation()}>
    {questions.map(question => <fieldset key={question.qid} disabled={busy || Boolean(request.answers && Object.hasOwn(request.answers, question.qid))}><legend>{question.question}</legend>
      {(question.choices ?? []).filter(choice => typeof choice === "string" && choice.trim() && choice.length <= 8020).map((choice, index) => <label key={index}><input type={question.multi_select ? "checkbox" : "radio"} name={question.qid} checked={(selected[question.qid] ?? []).includes(choice)} onChange={() => { setText(old => ({ ...old, [question.qid]: "" })); setSelected(old => ({ ...old, [question.qid]: question.multi_select ? (old[question.qid]?.includes(choice) ? old[question.qid].filter(item => item !== choice) : [...old[question.qid] ?? [], choice]) : [choice] })); }} /><span>{bare(choice)}{choice !== bare(choice) && <small>{ht("推荐")}</small>}</span></label>)}
      <label className="hermes-clarify-text"><span>{ht(question.choices?.length ? "其他回答" : "回答")}</span><textarea value={text[question.qid] ?? request.answers?.[question.qid] ?? ""} onChange={event => { setText(old => ({ ...old, [question.qid]: event.target.value })); if (!question.multi_select) setSelected(old => ({ ...old, [question.qid]: [] })); }} maxLength={100000} /></label>
    </fieldset>)}
    {error && <ConfigNotice>{error}</ConfigNotice>}<footer><ConfigButton disabled={busy} onClick={() => void submit(true)}>{ht("跳过")}</ConfigButton><ConfigButton variant="primary" disabled={busy || !Object.values(answers).some(Boolean)} type="submit">{ht(busy ? "正在提交…" : "提交回答")}</ConfigButton></footer>
  </form>;
}
