ALTER TABLE session_turns
  ADD COLUMN input_text text,
  ADD COLUMN input_text_truncated boolean NOT NULL DEFAULT false,
  ADD COLUMN title text,
  ADD COLUMN title_source text;
