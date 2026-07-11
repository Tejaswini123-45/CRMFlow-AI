/**
 * Default Configuration Values
 * Implements LLD §9 Configuration Strategy
 * 
 * This file contains all runtime-tunable configuration values.
 * Deployment-time configuration (endpoints, environment names) is kept separate.
 */

// Default configuration values matching PRD §9 CRM Schema
export const DEFAULT_CONFIG = {
  // Pipeline Thresholds
  mapping_confidence_threshold: 0.75,
  file_size_ceiling_rows: 10000,
  
  // Retry/Timeout Policy
  ai_mapping_timeout_ms: 30000, // 30 seconds
  ai_mapping_max_retries: 3,
  
  // Sampling
  header_analysis_sample_size: 10,
  
  // Target Schema Definition (from PRD §9)
  target_schema: {
    fields: [
      {
        id: 'first_name',
        business_meaning: "Lead's given name",
        alternative_names: ['Name', 'First', 'Fname', 'Given Name', 'Contact Name'],
        required: false,
        data_type: 'string',
      },
      {
        id: 'last_name',
        business_meaning: "Lead's family name",
        alternative_names: ['Surname', 'Lname', 'Last', 'Family Name'],
        required: false,
        data_type: 'string',
      },
      {
        id: 'email',
        business_meaning: 'Primary contact email',
        alternative_names: ['Email ID', 'E-mail', 'Contact Email', 'Email Address'],
        required: true,
        data_type: 'email',
      },
      {
        id: 'phone_number',
        business_meaning: 'Primary contact number',
        alternative_names: [
          'Mobile',
          'Contact No.',
          'WhatsApp No.',
          'Phone 1',
          'Telephone',
          'Cell',
        ],
        required: false,
        data_type: 'phone',
      },
      {
        id: 'source',
        business_meaning: 'Where the lead originated',
        alternative_names: ['Campaign', 'Lead Source', 'Platform', 'Origin'],
        required: false,
        data_type: 'string',
      },
      {
        id: 'created_date',
        business_meaning: 'When the lead was generated',
        alternative_names: ['Date', 'Submitted On', 'Lead Date', 'Created', 'Timestamp'],
        required: false,
        data_type: 'date',
      },
      {
        id: 'notes',
        business_meaning: 'Free-text lead context',
        alternative_names: ['Message', 'Comments', 'Additional Info', 'Description'],
        required: false,
        data_type: 'text',
      },
      {
        id: 'company',
        business_meaning: "Lead's organization (B2B)",
        alternative_names: ['Company Name', 'Organization', 'Business', 'Employer'],
        required: false,
        data_type: 'string',
      },
      {
        id: 'status',
        business_meaning: 'Lead lifecycle stage',
        alternative_names: ['Lead Status', 'Stage', 'State'],
        required: false,
        data_type: 'string',
      },
    ],
  },
  
  // Validation Rules
  validation: {
    email_required: true,
    phone_required: false,
    min_phone_digits: 7,
  },
};
