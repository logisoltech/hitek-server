const express = require('express');
const multer = require('multer');
const path = require('path');
const { parse: parseCsv } = require('csv-parse/sync');
const { createClient } = require('@supabase/supabase-js');
const { logActivity } = require('./activities');

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

const normalizeSortParam = (value) => {
  if (!value) return null;
  const normalized = value.toString().trim().toLowerCase().replace(':', '_');
  if (['price_asc', 'price-low-high', 'price_low_high'].includes(normalized)) {
    return { key: 'price', ascending: true };
  }
  if (['price_desc', 'price-high-low', 'price_high_low'].includes(normalized)) {
    return { key: 'price', ascending: false };
  }
  return null;
};

const coercePriceValue = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const cleaned = value.replace(/[^\d.-]/g, '');
    if (!cleaned) return null;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const attachType = (records, type) => {
  if (!Array.isArray(records)) return [];
  return records.map((item) => ({
    ...item,
    type,
  }));
};

router.get('/', async (req, res) => {
  try {
    const { sort, category, limit } = req.query;
    const sortConfig = normalizeSortParam(sort);
    const parsedLimit = Number(limit);
    const applyLimit = Number.isFinite(parsedLimit) && parsedLimit > 0;

    const normalizedCategory = category ? category.toString().trim().toLowerCase() : null;
    const wantsLaptops =
      !normalizedCategory || ['laptop', 'laptops', 'notebook', 'notebooks'].includes(normalizedCategory);
    const wantsPrinters =
      !normalizedCategory || ['printer', 'printers'].includes(normalizedCategory);
    const wantsScanners =
      normalizedCategory && ['scanner', 'scanners'].includes(normalizedCategory);

    const fetchPlans = [];
    if (wantsLaptops) {
      fetchPlans.push({
        type: 'laptop',
        request: supabase.from('laptops').select('*'),
      });
    }
    if (wantsPrinters) {
      fetchPlans.push({
        type: 'printer',
        request: supabase.from('printers').select('*'),
      });
      // Also fetch scanners when fetching printers (but not when explicitly requesting scanners)
      // Scanners should always have type='scanner' so product detail pages work correctly
      if (!wantsScanners) {
        fetchPlans.push({
          type: 'scanner', // Always use 'scanner' type for correct product detail routing
          request: supabase.from('scanners').select('*'),
        });
      }
    }
    if (wantsScanners) {
      fetchPlans.push({
        type: 'scanner',
        request: supabase.from('scanners').select('*'),
      });
    }

    if (fetchPlans.length === 0) {
      return res.json([]);
    }

    const responses = await Promise.all(fetchPlans.map(({ request }) => request));

    let combined = [];
    for (let index = 0; index < responses.length; index += 1) {
      const { data, error } = responses[index];
      const { type } = fetchPlans[index];

      if (error) {
        console.error(`Failed to fetch ${type} products:`, error);
        return res.status(500).json({ error: 'Failed to fetch products' });
      }

      combined = combined.concat(attachType(data || [], type));
    }

    if (sortConfig?.key === 'price') {
      combined = combined
        .slice()
        .sort((a, b) => {
          const priceA = coercePriceValue(a.price);
          const priceB = coercePriceValue(b.price);

          if (priceA === null && priceB === null) return 0;
          if (priceA === null) return sortConfig.ascending ? 1 : -1;
          if (priceB === null) return sortConfig.ascending ? -1 : 1;

          return sortConfig.ascending ? priceA - priceB : priceB - priceA;
        });
    } else {
      combined = combined
        .slice()
        .sort((a, b) => {
          const idA = Number(a.id);
          const idB = Number(b.id);
          if (Number.isFinite(idA) && Number.isFinite(idB)) {
            return idA - idB;
          }
          return (a.id || '').toString().localeCompare((b.id || '').toString());
        });
    }

    if (applyLimit) {
      combined = combined.slice(0, parsedLimit);
    }

    res.json(combined);
  } catch (err) {
    console.error('Unexpected error fetching products:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
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

const SCANNER_SPEC_MAP = {
  memory: 'memory',
  paper_types: 'paper_types',
  paper_size: 'paper_size',
  duplex: 'duplex',
  resolution: 'resolution',
  power: 'power',
  weight: 'weight',
  dimensions: 'dimensions',
  color_scan: 'color_scan',
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
  'featured',
];

const LAPTOP_ALLOWED_COLUMNS = [
  ...GENERAL_PRODUCT_COLUMNS,
  ...Object.values(LAPTOP_SPEC_MAP),
];

const PRINTER_ALLOWED_COLUMNS = [
  ...GENERAL_PRODUCT_COLUMNS,
  ...Object.values(PRINTER_SPEC_MAP),
];

const SCANNER_ALLOWED_COLUMNS = [
  ...GENERAL_PRODUCT_COLUMNS,
  ...Object.values(SCANNER_SPEC_MAP),
];

const parseOptionalBoolean = (value) => {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return null;
    if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n', 'off'].includes(normalized)) return false;
  }
  return null;
};

const ensureFeaturedLimit = async (tableName, shouldBeFeatured, excludeId = null) => {
  if (!shouldBeFeatured) return;

  let query = supabase
    .from(tableName)
    .select('id', { count: 'exact', head: true })
    .eq('featured', true);

  if (excludeId !== null && excludeId !== undefined) {
    query = query.neq('id', excludeId);
  }

  const { count, error } = await query;
  if (error) {
    throw error;
  }

  if ((count || 0) >= 3) {
    const limitError = new Error('You can feature at most 3 products in this category.');
    limitError.statusCode = 400;
    throw limitError;
  }
};

const LAPTOP_REQUIRED_COLUMNS = ['name', 'brand', 'price'];
const PRINTER_REQUIRED_COLUMNS = ['name', 'brand', 'price'];
const SCANNER_REQUIRED_COLUMNS = ['name', 'brand', 'price'];

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
const SCANNER_COLUMN_LOOKUP = buildColumnLookup(SCANNER_ALLOWED_COLUMNS);

const normalizeString = (value) => {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value.trim();
  return String(value).trim();
};

const mapSpecs = (category, specs = {}) => {
  let map;
  if (category === 'printer') {
    map = PRINTER_SPEC_MAP;
  } else if (category === 'scanner') {
    map = SCANNER_SPEC_MAP;
  } else {
    map = LAPTOP_SPEC_MAP;
  }
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

    if (column === 'featured') {
      const parsed = parseOptionalBoolean(rawValue);
      if (parsed !== null) {
        sanitized[column] = parsed;
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
  scanner: SCANNER_REQUIRED_COLUMNS,
};

const uploadImages = async (category, files) => {
  if (!files || !files.length) {
    return { urls: [], coverUrl: '' };
  }

  let bucket;
  if (category === 'printer') {
    bucket = 'printer_images';
  } else if (category === 'scanner') {
    bucket = 'scanner_images';
  } else {
    bucket = 'laptop_images';
  }

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
    if (!['laptop', 'printer', 'scanner'].includes(category)) {
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

    const requestedFeatured = parseOptionalBoolean(req.body.featured);
    const featuredFlag = requestedFeatured === null ? false : requestedFeatured;

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

    let tableName;
    if (category === 'printer') {
      tableName = 'printers';
    } else if (category === 'scanner') {
      tableName = 'scanners';
    } else {
      tableName = 'laptops';
    }

    if (tableName === 'laptops') {
      await ensureFeaturedLimit(tableName, featuredFlag);
    }

    const insertPayload = {
      ...details,
      ...specs,
      image: coverUrl,
      image_urls: urls,
      featured: featuredFlag,
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

    // Log activity - get user info from body (FormData) or headers
    const userFromBody = req.body?.cmsUserId || req.body?.cmsUserName || req.body?.cmsUserRole 
      ? {
          userId: req.body.cmsUserId,
          userName: req.body.cmsUserName,
          userRole: req.body.cmsUserRole,
        }
      : null;
    
    await logActivity({
      type: 'product_created',
      action: `Created new ${category}: ${data.name || details.name}`,
      entityType: 'product',
      entityId: data.id,
      entityName: data.name || details.name,
      details: {
        category,
        brand: data.brand || details.brand,
        price: data.price || details.price,
        stock: data.stock || details.stock,
      },
      // Pass user info directly if available from body
      userId: userFromBody?.userId,
      userName: userFromBody?.userName,
      userRole: userFromBody?.userRole,
    }, req);

    res.status(201).json({ product: data });
  } catch (err) {
    console.error('Unexpected error creating product:', err);
    if (err?.statusCode === 400) {
      res.status(400).json({ error: err.message });
    } else {
      res.status(500).json({ error: err?.message || 'Internal server error.' });
    }
  }
});

router.post('/bulk/csv', upload.single('file'), async (req, res) => {
  try {
    const category = normalizeString(req.body.category).toLowerCase();
    if (!['laptop', 'printer', 'scanner'].includes(category)) {
      return res.status(400).json({ error: 'Invalid or missing category. Use laptop, printer, or scanner.' });
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

    let columnLookup;
    if (category === 'printer') {
      columnLookup = PRINTER_COLUMN_LOOKUP;
    } else if (category === 'scanner') {
      columnLookup = SCANNER_COLUMN_LOOKUP;
    } else {
      columnLookup = LAPTOP_COLUMN_LOOKUP;
    }
    const requiredColumns = REQUIRED_COLUMNS_LOOKUP[category] || [];
    let tableName;
    if (category === 'printer') {
      tableName = 'printers';
    } else if (category === 'scanner') {
      tableName = 'scanners';
    } else {
      tableName = 'laptops';
    }

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
        const payload = {
          ...row.payload,
        };

        if (payload.featured === undefined || payload.featured === null) {
          payload.featured = false;
        } else {
          payload.featured = Boolean(payload.featured);
        }

        if (payload.featured) {
          await ensureFeaturedLimit(tableName, true);
        }

        const { data, error } = await supabase
          .from(tableName)
          .insert(payload)
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

    // Log activity for bulk import
    if (insertedRows.length > 0) {
      await logActivity({
        type: 'bulk_import',
        action: `Imported ${insertedRows.length} new ${category}${insertedRows.length > 1 ? 's' : ''} via bulk upload`,
        entityType: 'product',
        entityId: null,
        entityName: `${insertedRows.length} ${category}${insertedRows.length > 1 ? 's' : ''}`,
        details: {
          category,
          count: insertedRows.length,
          attempted: records.length,
          failed: rowErrors.length + insertionErrors.length,
        },
      }, req);
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
    let category;
    if (categoryParam === 'printer' || categoryParam === 'printers') {
      category = 'printer';
    } else if (categoryParam === 'scanner' || categoryParam === 'scanners') {
      category = 'scanner';
    } else if (categoryParam === 'laptop' || categoryParam === 'laptops') {
      category = 'laptop';
    } else {
      category = null;
    }

    if (!category) {
      return res.status(400).json({ error: 'Invalid product category.' });
    }

    const lookupId = parseLookupId(req.params.id);
    let tableName;
    if (category === 'printer') {
      tableName = 'printers';
    } else if (category === 'scanner') {
      tableName = 'scanners';
    } else {
      tableName = 'laptops';
    }

    // Get existing product to compare changes
    const { data: existingProduct, error: existingError } = await supabase
      .from(tableName)
      .select('*')
      .eq('id', lookupId)
      .single();

    if (existingError) {
      return res.status(404).json({ error: 'Product not found.' });
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

    if (!details.name) {
      return res.status(400).json({ error: 'Product name is required.' });
    }

    if (!details.brand) {
      return res.status(400).json({ error: 'Brand is required.' });
    }

    if (!details.price) {
      return res.status(400).json({ error: 'Price is required.' });
    }

    const requestedFeatured = parseOptionalBoolean(req.body.featured);

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

    if (requestedFeatured !== null && tableName === 'laptops' && requestedFeatured === true) {
      await ensureFeaturedLimit(tableName, true, lookupId);
    }

    const updatePayload = {
      ...details,
      ...specs,
      image: coverImage,
      image_urls: finalImages,
    };

    if (requestedFeatured !== null) {
      updatePayload.featured = requestedFeatured;
    }

    // Compare old vs new values to find what actually changed
    const changedFields = [];
    const normalizeValue = (val) => {
      if (val === null || val === undefined || val === '') return '';
      // Convert to string and trim, but preserve case for better comparison
      const str = String(val).trim();
      // For numeric fields, compare as numbers
      if (!isNaN(str) && str !== '') {
        return parseFloat(str);
      }
      return str.toLowerCase();
    };

    const compareValues = (oldVal, newVal) => {
      // Handle null/undefined/empty
      if ((!oldVal && !newVal) || (oldVal === '' && newVal === '')) return true;
      if (!oldVal || !newVal) return false;
      
      // Try numeric comparison first
      const oldNum = parseFloat(oldVal);
      const newNum = parseFloat(newVal);
      if (!isNaN(oldNum) && !isNaN(newNum)) {
        return oldNum === newNum;
      }
      
      // String comparison
      return String(oldVal).trim().toLowerCase() === String(newVal).trim().toLowerCase();
    };

    for (const key in updatePayload) {
      if (key === 'image' || key === 'image_urls') continue; // Skip image fields
      
      const oldValue = existingProduct[key];
      const newValue = updatePayload[key];
      
      if (!compareValues(oldValue, newValue)) {
        changedFields.push(key);
      }
    }

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

    // Log activity - only log if there were actual changes
    if (changedFields.length > 0) {
      // Also try to get user info from request body (FormData might not send headers properly)
      const userFromBody = req.body?.cmsUserId || req.body?.cmsUserName || req.body?.cmsUserRole 
        ? {
            userId: req.body.cmsUserId,
            userName: req.body.cmsUserName,
            userRole: req.body.cmsUserRole,
          }
        : null;
      
      await logActivity({
        type: 'product_updated',
        action: `Updated ${category}: ${data.name || details.name}`,
        entityType: 'product',
        entityId: data.id,
        entityName: data.name || details.name,
        details: {
          category,
          brand: data.brand || details.brand,
          price: data.price || details.price,
          stock: data.stock, // Use the updated value from database (data), not the form input
          changes: changedFields, // Only the fields that actually changed
        },
        // Pass user info directly if available from body
        userId: userFromBody?.userId,
        userName: userFromBody?.userName,
        userRole: userFromBody?.userRole,
      }, req);
    }

    res.json({ product: data });
  } catch (err) {
    console.error('Unexpected error updating product:', err);
    if (err?.statusCode === 400) {
      res.status(400).json({ error: err.message });
    } else {
      res.status(500).json({ error: err?.message || 'Internal server error.' });
    }
  }
});

module.exports = router;
