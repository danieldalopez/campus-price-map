# Licence for `data/barcodes.csv`

`data/barcodes.csv` (and the raw lookup it was built from, `data/raw/barcode_lookup.csv`) is an extract of
product data from **Open Food Facts** (https://world.openfoodfacts.org), with our own `item_id` and
`mapped_by` columns added.

Open Food Facts data is made available under the **Open Database License (ODbL) v1.0**:
https://opendatacommons.org/licenses/odbl/1-0/

Individual contents of the database are available under the Database Contents License:
https://opendatacommons.org/licenses/dbcl/1-0/

Because this file is a derived database of Open Food Facts, it is also released under the ODbL v1.0. You may
copy, share and adapt it, provided that you:

- **Attribute**: credit "Product data from Open Food Facts, available under the Open Database License (ODbL)"
  and link to https://world.openfoodfacts.org.
- **Share alike**: release any database you derive from this file under the ODbL.
- **Keep it open**: don't distribute it with technical restrictions that stop others from using it.

What we changed: kept only products sold in Canada from the brands we track, dropped multipacks and codes with
a bad check digit, and mapped each row by hand to one of the app's 23 items (`item_id`, empty when we don't
track it) with how sure that mapping is (`mapped_by`). See docs/SPEC.md section 6, "Barcodes".

The app also looks barcodes up live in the Open Food Facts API (`GET /api/barcode`). Those answers are shown
with the same attribution and are never stored.
