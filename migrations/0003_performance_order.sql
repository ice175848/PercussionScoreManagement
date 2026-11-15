ALTER TABLE band_score_rows ADD COLUMN performance_order INTEGER
  CHECK (performance_order IS NULL OR (typeof(performance_order) = 'integer' AND performance_order BETWEEN 1 AND 9999));

CREATE INDEX band_score_rows_piece ON band_score_rows(band_id, performance_name, title);
