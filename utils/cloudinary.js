const cloudinary = require('cloudinary').v2;
const { Readable } = require('stream');

// Configure Cloudinary with your environment variables
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'dn8cf0bdb',
  api_key: process.env.CLOUDINARY_API_KEY || '334764147489227',
  api_secret: process.env.CLOUDINARY_API_SECRET || 'CRofFxnD9zONG0jr59EpA7bybo0'
});

/**
 * Upload a file to Cloudinary
 * @param {Object} file - Multer file object
 * @param {String} folder - Cloudinary folder name
 * @returns {Promise<Object>} Cloudinary upload result
 */
const uploadToCloudinary = (file, folder = 'contest-uploads') => {
  return new Promise((resolve, reject) => {
    // If file is a buffer, we need to convert it to a stream
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        resource_type: 'auto',
        folder: folder,
        allowed_formats: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'pdf']
      },
      (error, result) => {
        if (error) {
          reject(error);
        } else {
          resolve(result);
        }
      }
    );

    // Handle both buffer and stream scenarios
    if (file.buffer) {
      const readableStream = new Readable();
      readableStream.push(file.buffer);
      readableStream.push(null);
      readableStream.pipe(uploadStream);
    } else if (file.stream) {
      file.stream.pipe(uploadStream);
    } else {
      reject(new Error('Invalid file object - no buffer or stream found'));
    }
  });
};

/**
 * Delete a file from Cloudinary
 * @param {String} publicId - Cloudinary public ID
 * @returns {Promise<Object>} Cloudinary delete result
 */
const deleteFromCloudinary = (publicId) => {
  return cloudinary.uploader.destroy(publicId);
};

module.exports = {
  cloudinary,
  uploadToCloudinary,
  deleteFromCloudinary
};