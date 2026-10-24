Write a held-out evaluation set of dictated pain notes for a pain-journal app. You have NO repository; do not look for one or read any files outside this empty directory. Write ONE file only: ./heldout.json (a JSON array). Print nothing else but a one-line summary.

Exactly 60 notes: 35 English (ids "ho-en-001".."ho-en-035", lang "en") and 25 Spanish (ids "ho-es-001".."ho-es-025", lang "es"). Today is Thursday 2026-10-22.

Style: what a person says into a phone mic after noticing pain. Short and natural (usually 1–2 sentences, a few rambling ones), with filler words (um, like, so, pues, bueno, o sea, este), some dictation typos/mishearings and missing punctuation. Spanish: mix Spain, Mexico and Latin American usage (e.g. "me duele un montón", "ando con dolor", "la chamorra/pantorrilla", "el talón", "la cadera", "antier", "ahorita", "re fuerte", "un dolorcito"). About 70% plain one-shot notes; about 30% tricky: denials ("not my knee, my ankle"), extra numbers that are not ratings (ages, counts, miles, times, dates, "3 days"), stray left/right that is not a side ("I left work", "right after", "a la derecha de la tienda"), self-corrections ("left wrist, no wait, right wrist"), both sides ("both knees", "las dos rodillas"), two different parts, no location at all, vague onset.

Each item: {"id","lang","note","tags":[...short tags...],"expect":{
 "location": one region id below or null,
 "locationStatus": "mapped" | "missing" (no body part said, or every part denied) | "unmapped" (a body part with no region id, e.g. head, shin, forearm... — no follow-up) | "ambiguous" (two or more different affected parts) | "need-side" (a sided part with no stated side) | "both" (same part both sides),
 "side": "left"|"right"|"both"|null (only if said for that part),
 "intensity": 0..10 only if clearly a 0–10 pain rating ("a 6", "7 out of 10", "como un cinco"), else null,
 "quality": [pain-quality words exactly as said, lowercase, e.g. "aching","sharp","punzante","ardor"] or [],
 "onset": {"date":"YYYY-MM-DD"} if it resolves to a past/today date (yesterday, last night, this morning, 3 days ago, last Monday=2026-10-19, ayer, anoche, antier/anteayer, hace dos días) or {"phrase":"words as said"} if a past onset with no exact date (e.g. "a few weeks ago", "earlier this week") or null (none, or future/not about onset),
 "activity": the activity words as said if a cause/activity is stated (e.g. "running", "jugando fútbol") else null,
 "followUp": "location" if locationStatus is missing or ambiguous, "side" if need-side, else "none" }}
Region ids (the ONLY allowed values): neck, chest, upper_back, lower_back, abdomen, left_shoulder, right_shoulder, left_elbow, right_elbow, left_wrist, right_wrist (wrist covers hand, fingers, thumb, palm), left_hip, right_hip, left_thigh, right_thigh, left_knee, right_knee, left_calf, right_calf, left_ankle, right_ankle, left_foot, right_foot (foot covers toes, heel, arch). Unsided regions (neck..abdomen) have side null. For status need-side, ambiguous, missing, unmapped, both: location null. Shoulder blade = upper_back; stomach/belly/barriga/panza = abdomen; hamstring/quad = thigh; shin is unmapped.
Never infer a location from an activity. Label strictly from what is said. Double-check every date and label.
