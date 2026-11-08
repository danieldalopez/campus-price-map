"""price_engine: the Lakeflow Declarative Pipeline (serverless) that turns bronze_* into silver_* and gold_*.

Spec: docs/SPEC.md, section 10, "The pipeline". Default catalog and schema come from databricks.yml
(workspace.cpm), so table names here are unqualified.

D1 STUB. D2 replaces this file with silver_prices, silver_votes, silver_outlet_distances, gold_price_status,
gold_official_prices, gold_item_stats, gold_price_comparisons and gold_parity; D8 adds gold_walk_worth.

Until then the pipeline defines one private dataset (not published to Unity Catalog) so that the refresh Job's
bronze_copy → price_engine wiring can run end to end without writing anything into workspace.cpm.
"""

from pyspark import pipelines as dp


@dp.materialized_view(
    name="stub_bronze_copy_status",
    comment="D1 stub: what the last 02_bronze_copy run copied. D2 replaces this file.",
    private=True,
)
def stub_bronze_copy_status():
    return spark.read.table("bronze_copy_log").select("source", "status", "lakebase_count", "delta_count", "snapshot_at")
