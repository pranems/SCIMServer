// Azure Database for PostgreSQL Flexible Server for SCIMServer
// Provisions a minimal single-node Flexible Server (Burstable B1ms) suitable for
// development and light production traffic. Upgrade to General Purpose for HA / higher IOPS.

param location string = resourceGroup().location

@description('Name of the PostgreSQL Flexible Server (must be globally unique within Azure)')
param serverName string

@description('Administrator login name')
param adminLogin string = 'scimadmin'

@description('Administrator password')
@secure()
param adminPassword string

@description('Database name to create')
param databaseName string = 'scimdb'

@description('SKU tier: Burstable (dev/test), GeneralPurpose (prod)')
@allowed(['Burstable', 'GeneralPurpose', 'MemoryOptimized'])
param skuTier string = 'Burstable'

@description('Compute SKU name. Burstable: Standard_B1ms, Standard_B2s. GeneralPurpose: Standard_D2ds_v4')
param skuName string = 'Standard_B1ms'

@description('Storage in MB (5120 minimum)')
param storageSizeMB int = 32768

@description('PostgreSQL version')
@allowed(['14', '15', '16'])
param postgresVersion string = '16'

@description('Backup retention days (7–35)')
param backupRetentionDays int = 7

resource server 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: serverName
  location: location
  sku: {
    name: skuName
    tier: skuTier
  }
  properties: {
    administratorLogin: adminLogin
    administratorLoginPassword: adminPassword
    version: postgresVersion
    storage: {
      storageSizeGB: storageSizeMB / 1024
    }
    backup: {
      backupRetentionDays: backupRetentionDays
      geoRedundantBackup: 'Disabled'
    }
    network: {
      // Public access with firewall rules (simplest setup)
      // For VNet-integrated deployments, set 'delegatedSubnetResourceId' and 'privateDnsZoneArmResourceId'
      publicNetworkAccess: 'Enabled'
    }
    highAvailability: {
      mode: 'Disabled'
    }
    authConfig: {
      activeDirectoryAuth: 'Disabled'
      passwordAuth: 'Enabled'
    }
  }
  tags: {
    project: 'scimserver'
  }
}

// Allow Azure services to reach the server (required for Container Apps outbound connections)
resource allowAzureServices 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2024-08-01' = {
  parent: server
  name: 'AllowAllAzureServices'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

resource database 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = {
  parent: server
  name: databaseName
  properties: {
    charset: 'UTF8'
    collation: 'en_US.utf8'
  }
}

output serverFqdn string = server.properties.fullyQualifiedDomainName
output serverName string = server.name
output databaseName string = database.name
// Construct the DATABASE_URL connection string for use in Container App secret
#disable-next-line outputs-should-not-contain-secrets
output databaseUrl string = 'postgresql://${adminLogin}:${adminPassword}@${server.properties.fullyQualifiedDomainName}:5432/${databaseName}?sslmode=require'
