import Product from '../models/productModel.js';
import { deleteFile } from '../utils/file.js';
import fetch from 'node-fetch';

// @desc     Fetch All Products
// @method   GET
// @endpoint /api/v1/products?limit=2&skip=0
// @access   Public
const getProducts = async (req, res, next) => {
  try {
    const total = await Product.countDocuments();
    const maxLimit = process.env.PAGINATION_MAX_LIMIT;
    const maxSkip = total === 0 ? 0 : total - 1;
    const limit = Number(req.query.limit) || maxLimit;
    const skip = Number(req.query.skip) || 0;
    const search = req.query.search || '';
    console.log({
      total,
      maxLimit,
      maxSkip,
      limit,
      skip,
      search,
    });
    

    const products = await Product.find({
      name: { $regex: search, $options: 'i' }
    })
      .limit(limit > maxLimit ? maxLimit : limit)
      .skip(skip > maxSkip ? maxSkip : skip < 0 ? 0 : skip);

    if (!products || products.length === 0) {
      res.statusCode = 404;
      throw new Error('Products not found!');
    }

    res.status(200).json({
      products,
      total,
      maxLimit,
      maxSkip
    });
  } catch (error) {
    next(error);
  }
};

// @desc     Fetch top products
// @method   GET
// @endpoint /api/v1/products/top
// @access   Public
const getTopProducts = async (req, res, next) => {
  try {
    const products = await Product.find({}).sort({ rating: -1 }).limit(3);

    if (!products) {
      res.statusCode = 404;
      throw new Error('Product not found!');
    }

    res.status(200).json(products);
  } catch (error) {
    next(error);
  }
};

// @desc     Fetch Single Product
// @method   GET
// @endpoint /api/v1/products/:id
// @access   Public
const getProduct = async (req, res, next) => {
  try {
    const { id: productId } = req.params;
    const product = await Product.findById(productId);

    if (!product) {
      res.statusCode = 404;
      throw new Error('Product not found!');
    }

    res.status(200).json(product);
  } catch (error) {
    next(error);
  }
};

// @desc     Create product
// @method   POST
// @endpoint /api/v1/products
// @access   Private/Admin
const createProduct = async (req, res, next) => {
  try {
    const { name, image, description, brand, category, price, countInStock } =
      req.body;
    console.log(req.file);
    const product = new Product({
      user: req.user._id,
      name,
      image,
      description,
      brand,
      category,
      price,
      countInStock
    });
    const createdProduct = await product.save();

    res.status(200).json({ message: 'Product created', createdProduct });
  } catch (error) {
    next(error);
  }
};

// @desc     Update product
// @method   PUT
// @endpoint /api/v1/products/:id
// @access   Private/Admin
const updateProduct = async (req, res, next) => {
  try {
    const { name, image, description, brand, category, price, countInStock } =
      req.body;

    const product = await Product.findById(req.params.id);

    if (!product) {
      res.statusCode = 404;
      throw new Error('Product not found!');
    }

    // Save the current image path before updating
    const previousImage = product.image;

    product.name = name || product.name;
    product.image = image || product.image;
    product.description = description || product.description;
    product.brand = brand || product.brand;
    product.category = category || product.category;
    product.price = price || product.price;
    product.countInStock = countInStock || product.countInStock;

    const updatedProduct = await product.save();

    // Delete the previous image if it exists and if it's different from the new image
    if (previousImage && previousImage !== updatedProduct.image) {
      deleteFile(previousImage);
    }

    res.status(200).json({ message: 'Product updated', updatedProduct });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete product
// @method   DELETE
// @endpoint /api/v1/products/:id
// @access   Admin
const deleteProduct = async (req, res, next) => {
  try {
    const { id: productId } = req.params;
    const product = await Product.findById(productId);

    if (!product) {
      res.statusCode = 404;
      throw new Error('Product not found!');
    }
    await Product.deleteOne({ _id: product._id });
    deleteFile(product.image); // Remove upload file

    res.status(200).json({ message: 'Product deleted' });
  } catch (error) {
    next(error);
  }
};

// @desc    Create product review
// @method   POST
// @endpoint /api/v1/products/reviews/:id
// @access   Admin
const createProductReview = async (req, res, next) => {
  try {
    const { id: productId } = req.params;
    const { rating, comment } = req.body;

    const product = await Product.findById(productId);

    if (!product) {
      res.statusCode = 404;
      throw new Error('Product not found!');
    }

    const alreadyReviewed = product.reviews.find(
      review => review.user._id.toString() === req.user._id.toString()
    );

    if (alreadyReviewed) {
      res.statusCode = 400;
      throw new Error('Product already reviewed');
    }

    const review = {
      user: req.user,
      name: req.user.name,
      rating: Number(rating),
      comment
    };

    product.reviews = [...product.reviews, review];

    product.rating =
      product.reviews.reduce((acc, review) => acc + review.rating, 0) /
      product.reviews.length;
    product.numReviews = product.reviews.length;

    await product.save();

    res.status(201).json({ message: 'Review added' });
  } catch (error) {
    next(error);
  }
};

// @desc     Fetch products from external API and sync with database
// @method   POST
// @endpoint /api/v1/products/sync-external
// @access   Private/Admin
const syncExternalProducts = async (req, res, next) => {
  try {
    const { apiSource, category, limit = 20 } = req.body;
    
    let externalProducts = [];
    
    // Fetch from different API sources
    switch (apiSource) {
      case 'fakestore':
        externalProducts = await fetchFromFakeStore(category, limit);
        break;
      case 'bestbuy':
        externalProducts = await fetchFromBestBuy(category, limit);
        break;
      case 'amazon':
        externalProducts = await fetchFromAmazon(category, limit);
        break;
      default:
        throw new Error('Invalid API source');
    }
    
    // Transform external data to match your product schema
    const transformedProducts = externalProducts.map(product => ({
      name: product.name || product.title,
      image: product.image || product.imageUrl,
      description: product.description,
      brand: product.brand || extractBrandFromName(product.name || product.title),
      category: 'Electronics',
      price: Math.round((product.price || 0) * 83), // Convert to INR (approximate)
      countInStock: Math.floor(Math.random() * 20) + 1, // Random stock
      rating: product.rating?.rate || Math.random() * 2 + 3, // Random rating 3-5
      numReviews: product.rating?.count || Math.floor(Math.random() * 100) + 10,
      user: req.user._id,
      isExternalProduct: true,
      externalSource: apiSource,
      externalId: product.id || product._id
    }));
    
    // Save to database (avoid duplicates)
    const savedProducts = [];
    for (const product of transformedProducts) {
      const existingProduct = await Product.findOne({
        $or: [
          { name: product.name },
          { externalId: product.externalId, externalSource: product.externalSource }
        ]
      });
      
      if (!existingProduct) {
        const newProduct = new Product(product);
        const savedProduct = await newProduct.save();
        savedProducts.push(savedProduct);
      }
    }
    
    res.status(200).json({
      message: `Successfully synced ${savedProducts.length} products from ${apiSource}`,
      syncedProducts: savedProducts.length,
      totalProducts: await Product.countDocuments()
    });
    
  } catch (error) {
    next(error);
  }
};

// Helper function to fetch from Fake Store API
const fetchFromFakeStore = async (category, limit) => {
  try {
    const response = await fetch(`https://fakestoreapi.com/products?limit=${limit}`);
    const products = await response.json();
    
    // Filter for electronics/laptops
    return products.filter(product => 
      product.category === 'electronics' || 
      product.title.toLowerCase().includes('laptop') ||
      product.title.toLowerCase().includes('computer')
    );
  } catch (error) {
    console.error('Error fetching from Fake Store:', error);
    return [];
  }
};

// Helper function to fetch from Best Buy API (you'll need an API key)
const fetchFromBestBuy = async (category, limit) => {
  try {
    // You'll need to sign up for Best Buy API key
    const API_KEY = process.env.BESTBUY_API_KEY;
    if (!API_KEY) {
      throw new Error('Best Buy API key not configured');
    }
    
    const response = await fetch(
      `https://api.bestbuy.com/v1/products?format=json&apiKey=${API_KEY}&show=name,price,description,image,rating&pageSize=${limit}&categoryPath.id=abcat0502000`
    );
    const data = await response.json();
    
    return data.products || [];
  } catch (error) {
    console.error('Error fetching from Best Buy:', error);
    return [];
  }
};

// Helper function to fetch from Amazon (requires Product Advertising API)
const fetchFromAmazon = async (category, limit) => {
  try {
    // This requires Amazon Product Advertising API setup
    // You'll need access key, secret key, and associate tag
    throw new Error('Amazon API integration requires additional setup');
  } catch (error) {
    console.error('Error fetching from Amazon:', error);
    return [];
  }
};

// Helper function to extract brand from product name
const extractBrandFromName = (name) => {
  const brands = ['ACER', 'HP', 'ASUS', 'MSI', 'DELL', 'LENOVO', 'APPLE', 'SAMSUNG', 'TOSHIBA'];
  const upperName = name.toUpperCase();
  
  for (const brand of brands) {
    if (upperName.includes(brand)) {
      return brand;
    }
  }
  return 'UNKNOWN';
};

export {
  getProducts,
  getTopProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
  createProductReview,
  syncExternalProducts
};
