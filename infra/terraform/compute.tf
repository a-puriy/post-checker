# =============================================================================
# Service Account
# =============================================================================

resource "google_service_account" "dify_vm" {
  account_id   = "${local.name_prefix}-vm-${local.name_suffix}"
  display_name = "Dify VM Service Account"
}

# GCS access for Dify storage
resource "google_storage_bucket_iam_member" "vm_storage_admin" {
  bucket = google_storage_bucket.dify_storage.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.dify_vm.email}"
}

# Cloud SQL access
resource "google_project_iam_member" "vm_cloudsql_client" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.dify_vm.email}"
}

# =============================================================================
# Static IP
# =============================================================================

resource "google_compute_address" "dify_static_ip" {
  name   = "${local.name_prefix}-ip-${local.name_suffix}"
  region = var.region
}

# =============================================================================
# VM Instance
# =============================================================================

resource "google_compute_instance" "dify" {
  name         = "${local.name_prefix}-vm-${local.name_suffix}"
  machine_type = var.vm_machine_type
  zone         = "${var.region}-b"

  tags = ["dify-vm"]

  boot_disk {
    initialize_params {
      image = "ubuntu-os-cloud/ubuntu-2204-lts"
      size  = var.vm_disk_size
      type  = "pd-standard"
    }
  }

  network_interface {
    subnetwork = google_compute_subnetwork.main.id

    access_config {
      nat_ip = google_compute_address.dify_static_ip.address
    }
  }

  service_account {
    email  = google_service_account.dify_vm.email
    scopes = ["cloud-platform"]
  }

  # Install Docker and Docker Compose only
  metadata_startup_script = <<-EOF
    #!/bin/bash
    set -e

    # Skip if already installed
    if command -v docker &> /dev/null; then
      echo "Docker already installed"
      exit 0
    fi

    # Install Docker
    apt-get update
    apt-get install -y ca-certificates curl gnupg

    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg

    echo \
      "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
      $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
      tee /etc/apt/sources.list.d/docker.list > /dev/null

    apt-get update
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

    # Add default user to docker group
    usermod -aG docker ubuntu

    echo "Docker installation completed"
  EOF

  depends_on = [
    google_project_service.apis,
    google_sql_database_instance.main,
    google_storage_bucket.dify_storage,
  ]
}
