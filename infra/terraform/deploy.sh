#!/bin/bash
set -e

cd "$(dirname "$0")"

# Load .env if exists
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
else
  echo "Error: .env file not found. Copy .env.example to .env and fill in the values."
  exit 1
fi

# Validate required variables
if [ -z "$TF_VAR_PROJECT_ID" ] || [ -z "$TF_VAR_SECRET_KEY" ] || [ -z "$TF_VAR_INIT_PASSWORD" ]; then
  echo "Error: Required environment variables are not set."
  echo "Please ensure TF_VAR_PROJECT_ID, TF_VAR_SECRET_KEY, and TF_VAR_INIT_PASSWORD are set in .env"
  exit 1
fi

# Generate terraform.tfvars from template
envsubst < terraform.tfvars.template > terraform.tfvars
echo "Generated terraform.tfvars from template"

# Run terraform
terraform init
terraform apply "$@"
