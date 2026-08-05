# Traks resource layer — managed by OpenTofu/Terraform.
#
# This file declares every Cloudflare *resource* a Traks instance needs.
# Workers themselves are NOT here: they need bundling, static-asset upload,
# D1 migrations, and secrets — all of which stay with wrangler, orchestrated
# by installer/cli.mjs (which also runs this file via `tofu apply`).
#
# Instances are isolated via workspaces: one workspace per --instance name,
# so each instance has its own state and destroy can only ever touch the
# resources recorded for that instance.
#
# Terraform-shop buyers can also drive this directly:
#   tofu init && tofu workspace new traks
#   tofu apply -var instance=traks -var account_id=... -var catalog_token=...
# then run the CLI once for the wrangler half (build, deploy, migrations).

terraform {
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.19"
    }
  }
}

variable "instance" {
  type        = string
  description = "Instance prefix; every resource name derives from it."
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,20}$", var.instance))
    error_message = "instance must be lowercase alphanumeric/hyphens."
  }
}

variable "account_id" {
  type        = string
  description = "Cloudflare account ID to provision into."
}

variable "catalog_token" {
  type        = string
  sensitive   = true
  default     = ""
  description = <<-EOT
    R2 token (SQL Read + Data Catalog Write + Storage Write) stored on the
    Iceberg sink as its service credential. Required on first apply; may be
    omitted afterwards (the sink ignores config drift — see lifecycle below).
    Note: like all Terraform-managed credentials it is persisted in the local
    state file; keep state out of version control.
  EOT
}

# Provider auth comes from the CLOUDFLARE_API_TOKEN env var (the CLI passes
# either a real API token or the wrangler OAuth session token).
provider "cloudflare" {}

locals {
  us = replace(var.instance, "-", "_")
  # The CLI copies pipeline-schema.json (source of truth: scripts/) next to
  # this file when materializing the working dir under ~/.traks/terraform.
  schema = jsondecode(file("${path.module}/pipeline-schema.json"))
}

# ── data platform ────────────────────────────────────────────────────

resource "cloudflare_r2_bucket" "events" {
  account_id = var.account_id
  name       = "${var.instance}-events"
}

resource "cloudflare_r2_data_catalog" "catalog" {
  account_id  = var.account_id
  bucket_name = cloudflare_r2_bucket.events.name
}

resource "cloudflare_pipeline_stream" "events" {
  account_id = var.account_id
  name       = "${local.us}_events_stream"
  format     = { type = "json" }
  schema = {
    fields = local.schema.fields
  }
  # Events enter only through the collect worker's binding.
  http = {
    enabled        = false
    authentication = false
    cors           = {}
  }
  # The provider re-computes endpoint/worker_binding on every plan, producing
  # a permanent phantom in-place update. Streams are effectively immutable
  # (schema changes need delete + recreate regardless), so suppress all drift;
  # intentional schema changes go through `tofu taint` / recreate.
  lifecycle {
    ignore_changes = all
  }
}

resource "cloudflare_pipeline_sink" "events" {
  account_id = var.account_id
  name       = "${local.us}_events_sink"
  type       = "r2_data_catalog"
  # The sink config references the bucket by *name*, so Terraform can't infer
  # that it must wait for the catalog to finish enabling — without this, sink
  # creation races the catalog and intermittently 422s.
  depends_on = [cloudflare_r2_data_catalog.catalog]
  format     = { type = "parquet" }
  config = {
    account_id = var.account_id
    bucket     = cloudflare_r2_bucket.events.name
    table_name = "traks.events"
    token      = var.catalog_token
  }
  # The token is only needed at creation; later applies may run without
  # CATALOG_TOKEN (e.g. routine `update`), so ignore config drift instead
  # of resetting the stored credential to "". `schema` is API-computed on
  # the sink and, if diffed, forces a replacement the pipeline blocks —
  # ignore it too.
  lifecycle {
    ignore_changes = [config, schema]
  }
}

resource "cloudflare_pipeline" "events" {
  account_id = var.account_id
  name       = "${local.us}_events"
  sql        = "INSERT INTO ${cloudflare_pipeline_sink.events.name} SELECT * FROM ${cloudflare_pipeline_stream.events.name}"
}

# ── app storage ──────────────────────────────────────────────────────

resource "cloudflare_d1_database" "db" {
  account_id = var.account_id
  name       = "${var.instance}-db"
  # We only manage existence + name (fixed per workspace). The provider
  # otherwise tries to PUT API-computed attributes back on re-apply, which
  # the D1 API rejects with a 400.
  lifecycle {
    ignore_changes = all
  }
}

resource "cloudflare_workers_kv_namespace" "cache" {
  account_id = var.account_id
  title      = "${var.instance}-r2sql-cache"
}

# ── outputs consumed by installer/cli.mjs ────────────────────────────

output "stream_id" {
  value = cloudflare_pipeline_stream.events.id
}

output "d1_id" {
  value = cloudflare_d1_database.db.id
}

output "kv_id" {
  value = cloudflare_workers_kv_namespace.cache.id
}

output "bucket" {
  value = cloudflare_r2_bucket.events.name
}
