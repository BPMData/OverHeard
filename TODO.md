# TODO

## Ideas

### Conversation mode (two-way text-message style translation)

A third display mode for one-on-one conversations with a student: a chat-style thread
where each person's speech "arrives" as a message bubble in the other person's language.

- Teacher talks → transcribed in English → appears on the student's side translated
  into their language (with the English underneath, smaller).
- Student talks → transcribed in their language → appears on the teacher's side in English.

**Feasibility notes**

- The Web Speech API can recognize many languages: set `recognition.lang` (e.g. `es-US`,
  `pt-BR`, `ar-SA`, `zh-CN`, `vi-VN`, `uk-UA`). Translation back to English reuses the
  existing translators with the source and target languages swapped. The server's
  `/api/mt` and on-device `Translator` calls currently assume English as the source.
- It can't detect which language is being spoken, and one recognizer listens for one
  language at a time. So turns need a switch: two big "Me" / "Student" buttons
  (press to talk), or a toggle that flips `recognition.lang` between turns.
- Check speech recognition support for Haitian Creole, Somali, Dari and Pashto
  before promising them. On-device speech packs cover fewer languages than Google's
  cloud recognition.
- Optional: read each new bubble aloud with `speechSynthesis` in the listener's language.
