const express = require('express');
const multer = require('multer');
const path = require('path');
const { parse: parseCsv } = require('csv-parse/sync');
const { createClient } = require('@supabase/supabase-js');

const router = express.Router();

const supabaseUrl = process.env.SUPABASE_URL || 'https://svyrkggjjkbxsbvumfxj.supabase.co';
const supabaseServiceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN2eXJrZ2dqamtieHNidnVtZnhqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIyODgyNTEsImV4cCI6MjA3Nzg2NDI1MX0.1aRKA1GT8nM2eNKF6-bqQV9K40vP7cRSxuj-QtbpO0g';

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 8 * 1024 * 1024, // 8MB per file
    files: 10,
  },
});

const LAPTOP_SPEC_MAP = {
  processor: 'processor',
  graphics: 'graphics',
  display: 'display',
  memory: 'memory',
  storage: 'storage',
  adapter: 'adapter',
  wifi: 'wifi',
  bluetooth: 'bluetooth',
  camera: 'camera',
  ports: 'port',
  operatingSystem: 'os',
  microphone: 'mic',
  battery: 'battery',
  warranty: 'warranty',
};

const PRINTER_SPEC_MAP = {
  brand: 'brand',
  series: 'series',
  memory: 'memory',
  paperInput: 'paperinput',
  paperOutput: 'paperoutput',
  paperTypes: 'papertypes',
  dimensions: 'dimensions',
  weight: 'weight',
  power: 'power',
  warranty: 'warranty',
  resolution: 'resolution',
  duplex: 'duplex',
  copyFeature: 'copyfeature',
  scanFeature: 'scanfeature',
  wireless: 'wireless',
};

const GENERAL_PRODUCT_COLUMNS = [
  'name',
  'brand',
  'model',
  'series',
  'sku',
  'price',
  'stock',
  'description',
  'image',
  'image_urls',
];

const LAPTOP_ALLOWED_COLUMNS = [
  ...GENERAL_PRODUCT_COLUMNS,
  ...Object.values(LAPTOP_SPEC_MAP),
];

const PRINTER_ALLOWED_COLUMNS = [
  ...GENERAL_PRODUCT_COLUMNS,
  ...Object.values(PRINTER_SPEC_MAP),
];

const LAPTOP_REQUIRED_COLUMNS = ['name', 'brand', 'price'];
const PRINTER_REQUIRED_COLUMNS = ['name', 'brand', 'price'];

const buildColumnLookup = (columnList) => {
  const set = new Set(columnList);
  const lowerCaseMap = columnList.reduce((acc, column) => {
    acc[column.toLowerCase()] = column;
    return acc;
  }, {});
  return { set, lowerCaseMap };
};

const LAPTOP_COLUMN_LOOKUP = buildColumnLookup(LAPTOP_ALLOWED_COLUMNS);
const PRINTER_COLUMN_LOOKUP = buildColumnLookup(PRINTER_ALLOWED_COLUMNS);

const normalizeString = (value) => {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value.trim();
  return String(value).trim();
};

const mapSpecs = (category, specs = {}) => {
  const map = category === 'printer' ? PRINTER_SPEC_MAP : LAPTOP_SPEC_MAP;
  return Object.entries(specs).reduce((acc, [key, value]) => {
    const target = map[key];
    if (!target) return acc;
    const normalized = normalizeString(value);
    if (!normalized) return acc;
    acc[target] = normalized;
    return acc;
  }, {});
};

const parseLookupId = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : value;
};

const parseSpecsPayload = (raw) => {
  if (!raw) return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch (error) {
      return {};
    }
  }
  return {};
};

const parseExistingImages = (raw) => {
  if (!raw) return [];
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (Array.isArray(parsed)) {
      return parsed
        .map((value) => (typeof value === 'string' ? value.trim() : ''))
        .filter((value) => value);
    }
  } catch (error) {
    return [];
  }
  return [];
};

const parseImageUrls = (raw) => {
  if (raw === undefined || raw === null) return [];
  if (Array.isArray(raw)) {
    return raw
      .map((value) => (typeof value === 'string' ? value.trim() : String(value || '').trim()))
      .filter((value) => value);
  }

  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed
          .map((value) => (typeof value === 'string' ? value.trim() : String(value || '').trim()))
          .filter((value) => value);
      }
    } catch (error) {
      // fall through to delimiter split
    }
    return trimmed
      .split(/[;,|]/)
      .map((value) => value.trim())
      .filter((value) => value);
  }

  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return [String(raw)];
  }

  return [];
};

const coerceCsvValue = (value) => {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : null;
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  const stringValue = String(value).trim();
  return stringValue === '' ? null : stringValue;
};

const sanitizeCsvRow = (row, columnLookup) => {
  const sanitized = {};
  Object.entries(row || {}).forEach(([rawKey, rawValue]) => {
    if (!rawKey) return;
    const trimmedKey = rawKey.trim();
    if (!trimmedKey) return;

    const directMatch = columnLookup.set.has(trimmedKey) ? trimmedKey : null;
    const lookupMatch = columnLookup.lowerCaseMap[trimmedKey.toLowerCase()];
    const column = directMatch || lookupMatch;
    if (!column) return;

    if (column === 'image_urls') {
      const urls = parseImageUrls(rawValue);
      if (urls.length) {
        sanitized[column] = urls;
      }
      return;
    }

    const value = coerceCsvValue(rawValue);
    if (value === null) return;
    sanitized[column] = value;
  });
  return sanitized;
};

const REQUIRED_COLUMNS_LOOKUP = {
  laptop: LAPTOP_REQUIRED_COLUMNS,
  printer: PRINTER_REQUIRED_COLUMNS,
};

const uploadImages = async (category, files) => {
  if (!files || !files.length) {
    return { urls: [], coverUrl: '' };
  }

  const bucket = category === 'printer' ? 'printer_images' : 'laptop_images';

  const uploads = await Promise.all(
    files.map(async (file, index) => {
      const extension = path.extname(file.originalname) || '.jpg';
      const safeBase = path.basename(file.originalname, extension).replace(/[^a-zA-Z0-9-_]/g, '').slice(0, 32);
      const filePath = `${category}/${Date.now()}-${index}-${safeBase}${extension}`;

      const { error: uploadError } = await supabase.storage
        .from(bucket)
        .upload(filePath, file.buffer, {
          contentType: file.mimetype || 'application/octet-stream',
          cacheControl: '3600',
          upsert: false,
        });

      if (uploadError) {
        throw new Error(`Failed to upload image: ${uploadError.message || uploadError}`);
      }

      const {
        data: { publicUrl },
      } = supabase.storage.from(bucket).getPublicUrl(filePath);

      return publicUrl;
    })
  );

  return {
    urls: uploads,
    coverUrl: uploads[0] || '',
  };
};

router.post('/', upload.array('images', 10), async (req, res) => {
  try {
    const category = normalizeString(req.body.category).toLowerCase();
    if (!['laptop', 'printer'].includes(category)) {
      return res.status(400).json({ error: 'Invalid or missing product category.' });
    }

    const details = {
      name: normalizeString(req.body.name),
      brand: normalizeString(req.body.brand),
      model: normalizeString(req.body.model),
      series: normalizeString(req.body.series),
      sku: normalizeString(req.body.sku),
      price: normalizeString(req.body.price),
      stock: normalizeString(req.body.stock),
      description: normalizeString(req.body.description),
    };

    if (!details.name || !details.price) {
      return res.status(400).json({ error: 'Product name and price are required.' });
    }

    if (!details.brand) {
      return res.status(400).json({ error: 'Brand is required.' });
    }

    const specsPayload = parseSpecsPayload(req.body.specs);
    const specs = mapSpecs(category, specsPayload);

    const files = req.files || [];
    if (!files.length) {
      return res.status(400).json({ error: 'Please upload at least one product image.' });
    }

    const { urls, coverUrl } = await uploadImages(category, files);

    if (!coverUrl) {
      return res.status(500).json({ error: 'Unable to determine cover image URL.' });
    }

    const tableName = category === 'printer' ? 'printers' : 'laptops';

    const insertPayload = {
      ...details,
      ...specs,
      image: coverUrl,
      image_urls: urls,
    };

    const { data, error } = await supabase
      .from(tableName)
      .insert(insertPayload)
      .select('*')
      .single();

    if (error) {
      console.error('Failed to create product:', error);
      return res.status(500).json({
        error:
          error?.message ||
          error?.details ||
          error?.hint ||
          'Failed to create product. Check server logs for details.',
      });
    }

    res.status(201).json({ product: data });
  } catch (err) {
    console.error('Unexpected error creating product:', err);
    res.status(500).json({ error: err?.message || 'Internal server error.' });
  }
});

router.post('/bulk/csv', upload.single('file'), async (req, res) => {
  try {
    const category = normalizeString(req.body.category).toLowerCase();
    if (!['laptop', 'printer'].includes(category)) {
      return res.status(400).json({ error: 'Invalid or missing category. Use laptop or printer.' });
    }

    if (!req.file || !req.file.buffer || !req.file.buffer.length) {
      return res.status(400).json({ error: 'Please upload a CSV file.' });
    }

    let records;
    try {
      const csvString = req.file.buffer.toString('utf-8');
      records = parseCsv(csvString, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      });
    } catch (error) {
      return res.status(400).json({
        error: `Unable to parse CSV file: ${error.message || 'Invalid format.'}`,
      });
    }

    if (!Array.isArray(records) || !records.length) {
      return res.status(400).json({ error: 'CSV file does not contain any rows.' });
    }

    const columnLookup = category === 'printer' ? PRINTER_COLUMN_LOOKUP : LAPTOP_COLUMN_LOOKUP;
    const requiredColumns = REQUIRED_COLUMNS_LOOKUP[category] || [];
    const tableName = category === 'printer' ? 'printers' : 'laptops';

    const sanitizedRows = [];
    const rowErrors = [];

    records.forEach((row, index) => {
      const rowNumber = index + 2; // account for header row
      const sanitized = sanitizeCsvRow(row, columnLookup);
      const displayName = sanitized.name || row.name || row.model || null;

      if (Array.isArray(sanitized.image_urls) && sanitized.image_urls.length) {
        if (!sanitized.image || typeof sanitized.image !== 'string' || !sanitized.image.trim()) {
          sanitized.image = sanitized.image_urls[0];
        }
      }

      if (!Object.keys(sanitized).length) {
        rowErrors.push({
          row: rowNumber,
          name: displayName,
          error: 'Row does not contain any recognized columns.',
        });
        return;
      }

      const missingRequired = requiredColumns.filter((column) => !sanitized[column]);
      if (missingRequired.length) {
        rowErrors.push({
          row: rowNumber,
          name: displayName,
          error: `Missing required columns: ${missingRequired.join(', ')}`,
        });
        return;
      }

      sanitizedRows.push({
        payload: sanitized,
        rowNumber,
        displayName,
      });
    });

    if (!sanitizedRows.length) {
      return res.status(400).json({
        error: 'No valid rows found in CSV.',
        details: rowErrors,
      });
    }

    const insertedRows = [];
    const insertionErrors = [];

    for (const row of sanitizedRows) {
      try {
        const { data, error } = await supabase
          .from(tableName)
          .insert(row.payload)
          .select('*')
          .single();

        if (error) {
          throw error;
        }

        insertedRows.push({
          row: row.rowNumber,
          name: row.displayName || data?.name || null,
          record: data,
        });
      } catch (error) {
        insertionErrors.push({
          row: row.rowNumber,
          name: row.displayName,
          error: error?.message || error?.details || 'Failed to insert row.',
        });
      }
    }

    return res.json({
      summary: {
        category,
        attempted: records.length,
        processed: sanitizedRows.length,
        inserted: insertedRows.length,
        failed: rowErrors.length + insertionErrors.length,
      },
      inserted: insertedRows,
      rowValidationErrors: rowErrors,
      insertionErrors,
    });
  } catch (error) {
    console.error('Bulk CSV import error:', error);
    res.status(500).json({ error: error?.message || 'Failed to import CSV.' });
  }
});

router.patch('/:category/:id', upload.array('images', 10), async (req, res) => {
  try {
    const categoryParam = normalizeString(req.params.category).toLowerCase();
    const category =
      categoryParam === 'printer' || categoryParam === 'printers'
        ? 'printer'
        : categoryParam === 'laptop' || categoryParam === 'laptops'
          ? 'laptop'
          : null;

    if (!category) {
      return res.status(400).json({ error: 'Invalid product category.' });
    }

    const lookupId = parseLookupId(req.params.id);

    const details = {
      name: normalizeString(req.body.name),
      brand: normalizeString(req.body.brand),
      model: normalizeString(req.body.model),
      series: normalizeString(req.body.series),
      sku: normalizeString(req.body.sku),
      price: normalizeString(req.body.price),
      stock: normalizeString(req.body.stock),
      description: normalizeString(req.body.description),
    };

    if (!details.name) {
      return res.status(400).json({ error: 'Product name is required.' });
    }

    if (!details.brand) {
      return res.status(400).json({ error: 'Brand is required.' });
    }

    if (!details.price) {
      return res.status(400).json({ error: 'Price is required.' });
    }

    const specsPayload = parseSpecsPayload(req.body.specs);
    const specs = mapSpecs(category, specsPayload);

    const existingImages = parseExistingImages(req.body.existingImages);
    const files = req.files || [];

    let uploadedUrls = [];
    if (files.length) {
      const uploads = await uploadImages(category, files);
      uploadedUrls = uploads.urls;
    }

    let finalImages = [...existingImages, ...uploadedUrls]
      .map((url) => (typeof url === 'string' ? url.trim() : ''))
      .filter((url, index, array) => url && array.indexOf(url) === index);

    if (!finalImages.length) {
      return res.status(400).json({ error: 'At least one product image is required.' });
    }

    const coverExisting = normalizeString(req.body.coverExisting);
    const coverNewIndex =
      req.body.coverNewIndex !== undefined && req.body.coverNewIndex !== null
        ? Number(req.body.coverNewIndex)
        : null;

    let coverImage = '';
    if (coverExisting && finalImages.includes(coverExisting)) {
      coverImage = coverExisting;
    } else if (
      Number.isInteger(coverNewIndex) &&
      coverNewIndex >= 0 &&
      coverNewIndex < uploadedUrls.length
    ) {
      coverImage = uploadedUrls[coverNewIndex];
    } else if (existingImages.length && finalImages.includes(existingImages[0])) {
      coverImage = existingImages[0];
    } else {
      coverImage = finalImages[0];
    }

    const tableName = category === 'printer' ? 'printers' : 'laptops';

    const updatePayload = {
      ...details,
      ...specs,
      image: coverImage,
      image_urls: finalImages,
    };

    const { data, error } = await supabase
      .from(tableName)
      .update(updatePayload)
      .eq('id', lookupId)
      .select('*')
      .single();

    if (error) {
      console.error('Failed to update product:', error);
      return res.status(500).json({
        error:
          error?.message ||
          error?.details ||
          error?.hint ||
          'Failed to update product. Check server logs for details.',
      });
    }

    res.json({ product: data });
  } catch (err) {
    console.error('Unexpected error updating product:', err);
    res.status(500).json({ error: err?.message || 'Internal server error.' });
  }
});

module.exports = router;
