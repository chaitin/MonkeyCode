ALTER TABLE video_outputs
    DROP CONSTRAINT video_outputs_width_check,
    DROP CONSTRAINT video_outputs_height_check,
    ADD CONSTRAINT video_outputs_width_check CHECK (width > 0),
    ADD CONSTRAINT video_outputs_height_check CHECK (height > 0);
